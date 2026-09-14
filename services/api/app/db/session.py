"""Motor asincrono y fabrica de sesiones.

Una sesion por peticion, abierta y cerrada por la dependencia `get_session`.
Nunca compartas una AsyncSession entre peticiones: no es thread-safe y arrastra
el estado del identity map de la peticion anterior.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings, get_settings


def build_engine(settings: Settings) -> AsyncEngine:
    """Crea el motor.

    `pool_pre_ping` evita el error clasico de produccion: la conexion lleva
    horas en el pool, el servidor de Postgres ya la cerro, y la primera
    peticion de la manana revienta. Con pre_ping se descarta y se reabre.
    """
    is_sqlite = settings.database_url.startswith("sqlite")
    return create_async_engine(
        settings.database_url,
        echo=settings.debug,
        future=True,
        # SQLite no tiene pool que sondear.
        pool_pre_ping=not is_sqlite,
    )


def build_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _engine, _sessionmaker
    if _sessionmaker is None:
        _engine = build_engine(get_settings())
        _sessionmaker = build_sessionmaker(_engine)
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """Dependencia de FastAPI: una sesion por peticion.

    El commit lo hace el servicio que sabe que la unidad de trabajo termino, no
    esta funcion. Aqui solo se garantiza el rollback y el cierre.
    """
    factory = get_sessionmaker()
    async with factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    """Cierra el pool. Se llama en el shutdown de la app y entre tests."""
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
