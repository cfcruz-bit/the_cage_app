"""Entorno de Alembic.

Dos cosas que hace distinto de la plantilla por defecto, a proposito:

1. **Lee la URL de la configuracion**, no de alembic.ini. El DSN de produccion
   trae contrasena y no puede vivir en un archivo versionado.

2. **Corre sobre el motor asincrono**, el mismo que usa la aplicacion. Alembic
   es sincrono por dentro, asi que se envuelve con `connection.run_sync`.

`render_as_batch` se activa solo en SQLite: esa base no sabe hacer
ALTER TABLE DROP COLUMN, asi que Alembic reconstruye la tabla entera. En
Postgres no hace falta y solo estorbaria.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

# Importar el paquete entero registra TODAS las tablas en Base.metadata. Si
# falta una clase, la autogeneracion la interpretara como una tabla que sobra y
# escribira un drop_table.
from app.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

DATABASE_URL = get_settings().database_url
config.set_main_option("sqlalchemy.url", DATABASE_URL)

IS_SQLITE = DATABASE_URL.startswith("sqlite")


def run_migrations_offline() -> None:
    """Genera el SQL sin conectarse. Util para revisarlo antes de aplicarlo."""
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        render_as_batch=IS_SQLITE,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        render_as_batch=IS_SQLITE,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=NullPool,
    )
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
