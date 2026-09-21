"""Fixtures de la base de datos para los tests.

Decision importante: **el esquema de los tests lo crea Alembic**, no
`Base.metadata.create_all()`.

La diferencia no es cosmetica. `create_all` construye las tablas a partir de
los modelos, asi que un test que pase con ese metodo no prueba nada sobre las
migraciones: podrias tener una migracion rota y los tests seguirian verdes
hasta el despliegue. Corriendo `alembic upgrade head` se ejercita exactamente
el mismo camino que producira la base de produccion.

Se usa SQLite en archivo, no en memoria, porque cada conexion a `:memory:`
crea una base distinta y las migraciones se perderian.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security as _security

API_ROOT = Path(__file__).resolve().parents[1]

# Argon2 con parametros de produccion tarda ~150 ms por hash, y esta suite crea
# decenas de cuentas. Con los de produccion tardaba mas de dos minutos; con
# estos, segundos. Ver `use_fast_hashing_for_tests` para por que no debilita lo
# que estos tests comprueban.
_security.use_fast_hashing_for_tests()


def _alembic_config(db_url: str) -> Config:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


@pytest.fixture(scope="session")
def database_url(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    """Base temporal, migrada con Alembic, compartida por toda la sesion."""
    db_file = tmp_path_factory.mktemp("db") / "test.db"
    url = f"sqlite+aiosqlite:///{db_file}"

    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url

    from app.core.config import get_settings

    get_settings.cache_clear()

    command.upgrade(_alembic_config(url), "head")

    yield url

    get_settings.cache_clear()
    if previous is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = previous


@pytest_asyncio.fixture
async def session(database_url: str) -> AsyncIterator[AsyncSession]:
    """Sesion que se deshace al terminar: ningun test contamina al siguiente.

    Cada test corre dentro de una transaccion que SIEMPRE se revierte, asi que
    el orden de los tests no importa y no hace falta limpiar tablas a mano.
    """
    from app.core.config import Settings
    from app.db.session import build_engine, build_sessionmaker

    engine = build_engine(Settings(database_url=database_url))

    # SQLite ignora las claves foraneas salvo que se pidan explicitamente, y en
    # cada conexion. Sin esto, los tests de ON DELETE CASCADE pasarian sin
    # probar nada.
    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_connection, _record):  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    factory = build_sessionmaker(engine)
    async with factory() as s:
        await s.execute(text("SELECT 1"))
        try:
            yield s
        finally:
            await s.rollback()
    await engine.dispose()


@pytest_asyncio.fixture
async def client(database_url: str):
    """Cliente HTTP contra la app real, sin levantar un servidor.

    Se sustituye `get_session` por una que usa la base de pruebas. El resto de
    la aplicacion —routers, dependencias, autorizacion— es exactamente el
    codigo de produccion: los tests de permisos no valdrian nada si probaran
    una version simplificada.
    """
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import event

    from app.core.config import Settings, get_settings
    from app.core.rate_limit import limiter
    from app.db.session import build_engine, build_sessionmaker, get_session
    from app.main import app

    # El limiter es un singleton a nivel de modulo y todas las peticiones de
    # test comparten la misma IP (la del cliente httpx). Un solo escenario de
    # permisos ya crea y loguea a cuatro cuentas, mas peticiones de las que el
    # limite de produccion permite por minuto: no es señal de que el limite
    # este mal puesto, es que los tests no son el trafico que ese limite
    # regula. Se apaga aqui y se prueba aparte en test_rate_limit.py.
    limiter.enabled = False

    settings = Settings(database_url=database_url)
    engine = build_engine(settings)

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_connection, _record):  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    factory = build_sessionmaker(engine)

    async def _override():
        async with factory() as s:
            yield s

    app.dependency_overrides[get_session] = _override
    app.dependency_overrides[get_settings] = lambda: settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
    await engine.dispose()


ADMIN_PASSWORD = "clave-del-admin-123"


@pytest_asyncio.fixture
async def admin(client, session: AsyncSession) -> dict:
    """Un administrador creado directamente en la base.

    Es el unico camino posible y no es una trampa del test: las cuentas las
    crea un admin, asi que el primero no puede venir de la API. En produccion
    lo hace `scripts/create_admin.py`, que corre contra la base igual que esto.
    """
    import uuid as _uuid

    from app.core.security import hash_password
    from app.models import User, UserRole

    email = f"admin-{_uuid.uuid4().hex[:8]}@cage-test.com"
    session.add(
        User(
            email=email,
            password_hash=hash_password(ADMIN_PASSWORD),
            display_name="Camilo",
            role=UserRole.ADMIN.value,
        )
    )
    await session.commit()

    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": ADMIN_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {
        "email": email,
        "headers": {"Authorization": f"Bearer {r.json()['accessToken']}"},
    }
