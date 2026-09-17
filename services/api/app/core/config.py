"""Configuracion del servicio, leida del entorno.

Nada de secretos en el codigo. En desarrollo se leen de `.env`, que esta en el
.gitignore; en produccion los inyecta el proveedor.

`database_url` usa el driver asincrono a proposito:
    postgresql+asyncpg://...   en produccion
    sqlite+aiosqlite:///...    en los tests
Es la misma capa de SQLAlchemy en los dos casos, asi que los tests ejercitan el
codigo real y no una maqueta.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Valor de relleno para desarrollo. Si aparece en produccion, la app no
#: arranca: ver `_no_arrancar_en_produccion_con_la_clave_de_ejemplo`.
DEV_JWT_SECRET = "dev-only-change-me-dev-only-change-me-0123"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    #: Nombre que aparece en /docs.
    app_name: str = "The Cage API"
    environment: str = "development"
    debug: bool = False

    #: DSN asincrono. En produccion SIEMPRE postgresql+asyncpg.
    database_url: str = "sqlite+aiosqlite:///./cage.db"

    @field_validator("database_url")
    @classmethod
    def _normalizar_driver(cls, value: str) -> str:
        """Convierte el DSN que dan los proveedores al driver asincrono.

        Fly, Render y Railway inyectan `DATABASE_URL` con la forma
        `postgres://...` o `postgresql://...`, que SQLAlchemy resuelve al
        driver SINCRONO psycopg2 — que esta app no instala. El resultado seria
        un fallo en el arranque del primer despliegue con un mensaje sobre un
        modulo que nadie escribio.

        Se normaliza aqui y no en el proveedor para que nadie tenga que
        acordarse de reescribir la variable a mano cada vez que se rota.
        """
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+asyncpg://" + value[len(prefix) :]
        return value

    #: Clave de firma de los JWT. Minimo 32 bytes: por debajo de eso HS256
    #: tiene menos entropia que su propia salida (RFC 7518, seccion 3.2) y
    #: PyJWT avisa. El valor por defecto solo sirve en desarrollo.
    jwt_secret: str = Field(default=DEV_JWT_SECRET, min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 30

    #: Origenes permitidos para CORS. La app movil no lo necesita; el panel web
    #: del coach, si.
    cors_origins: list[str] = Field(default_factory=list)

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}

    @model_validator(mode="after")
    def _no_arrancar_en_produccion_con_la_clave_de_ejemplo(self) -> Settings:
        """Falla en el arranque, no en silencio.

        Desplegar con la clave de ejemplo significa que cualquiera que lea este
        repositorio puede firmarse un token de coach. Mejor que el despliegue
        se caiga a que funcione y este abierto.
        """
        if self.is_production and self.jwt_secret == DEV_JWT_SECRET:
            raise ValueError(
                "JWT_SECRET sigue siendo el de ejemplo. Genera uno con: "
                'python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Settings cacheadas. Se inyecta con Depends(get_settings) en los routers."""
    return Settings()
