"""Utilidades compartidas por las definiciones de tablas."""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import CheckConstraint


def enum_check(column: str, values: type[StrEnum], name: str) -> CheckConstraint:
    """CHECK que limita una columna a los valores de un StrEnum del dominio.

    Se genera a partir del enum en vez de escribir la lista a mano para que no
    puedan divergir: si alguien anade un valor en `app/domain/schemas.py` y
    regenera la migracion, el CHECK lo recoge solo.

    No se usa el tipo ENUM nativo de Postgres a proposito. Anadir un valor a un
    ENUM exige ALTER TYPE, que no corre dentro de la transaccion de la
    migracion, y es de donde salen la mitad de los despliegues a medias.
    """
    literals = ", ".join(f"'{v.value}'" for v in values)
    return CheckConstraint(f"{column} IN ({literals})", name=name)
