"""Base declarativa y piezas compartidas por todos los modelos.

Dos decisiones que conviene entender antes de tocar nada:

1. **Convencion de nombres de constraints.** Sin ella, Alembic genera indices y
   claves con nombres que inventa la base, y un `downgrade()` no sabe como se
   llamaba lo que tiene que borrar. Con ella, el nombre es deterministico y las
   migraciones son reversibles de verdad.

2. **Tipos portables.** `Uuid` y `String` con CHECK en vez de `UUID` nativo y
   `ENUM` de Postgres. Motivo: los tests corren sobre SQLite y tienen que
   ejercitar el MISMO codigo que produccion. Los ENUM nativos ademas son la
   fuente clasica de migraciones rotas, porque anadir un valor exige ALTER TYPE
   fuera de transaccion.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def new_uuid() -> uuid.UUID:
    """Id generado en Python, no en la base.

    Asi el objeto tiene id antes del INSERT y se pueden montar relaciones en
    memoria sin un flush por medio.
    """
    return uuid.uuid4()


class TimestampMixin:
    """created_at / updated_at gestionados por la base, no por la aplicacion.

    `server_default` y `onupdate` viven en el servidor para que un UPDATE hecho
    a mano desde psql tambien mueva la marca de tiempo.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
