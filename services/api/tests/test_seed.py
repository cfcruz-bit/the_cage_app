"""El catalogo sembrado.

Un error de dedo en un nombre de musculo no se ve leyendo la lista, pero
revienta el INSERT contra el CHECK de la base. Estos tests lo cazan sin
levantar nada.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.schemas import MuscleGroup
from app.models import ExerciseCatalog
from scripts.seed_exercises import CATALOG


def test_los_musculos_existen_en_el_enum() -> None:
    valid = {m.value for m in MuscleGroup}
    malos = sorted({s.muscle for s in CATALOG} - valid)
    assert not malos, f"musculos que la base rechazara: {malos}"


def test_los_rangos_de_reps_son_coherentes() -> None:
    malos = [s.name for s in CATALOG if s.rep_hi < s.rep_lo or s.rep_lo < 1]
    assert not malos


def test_el_rir_esta_en_rango() -> None:
    malos = [s.name for s in CATALOG if not 0 <= s.target_rir <= 10]
    assert not malos


def test_los_incrementos_son_positivos() -> None:
    malos = [s.name for s in CATALOG if s.load_increment_kg <= 0]
    assert not malos


def test_no_hay_ejercicios_repetidos() -> None:
    """La clave de idempotencia del seed es (nombre, equipo)."""
    claves = [(s.name, s.equipment) for s in CATALOG]
    assert len(claves) == len(set(claves))


def test_hay_al_menos_un_ejercicio_por_musculo() -> None:
    """Un coach tiene que poder montar un plan de cuerpo completo."""
    cubiertos = {s.muscle for s in CATALOG}
    faltan = sorted({m.value for m in MuscleGroup} - cubiertos)
    assert not faltan, f"musculos sin ningun ejercicio: {faltan}"


@pytest.mark.asyncio
async def test_el_catalogo_entra_en_la_base_sin_violar_ningun_check(
    session: AsyncSession,
) -> None:
    """La prueba de verdad: que la base los acepte."""
    for item in CATALOG:
        session.add(
            ExerciseCatalog(
                name=item.name,
                muscle=item.muscle,
                equipment=item.equipment,
                rep_lo=item.rep_lo,
                rep_hi=item.rep_hi,
                target_rir=item.target_rir,
                load_increment_kg=item.load_increment_kg,
            )
        )
    await session.flush()

    count = await session.execute(select(ExerciseCatalog))
    assert len(list(count.scalars())) >= len(CATALOG)
