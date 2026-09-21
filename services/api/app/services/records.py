"""Marcas de fuerza: cual es la vigente y que peso sale de un porcentaje.

Dos operaciones, y las dos tienen una trampa que conviene ver antes de tocar
nada.

**Cual es la vigente.** La mas reciente por `achieved_on`, no la ultima
insertada. Un coach que apunta el lunes la marca del sabado no debe desplazar a
una del domingo que ya estaba. Cuando dos caen el mismo dia —imposible por el
UNIQUE dentro del mismo ejercicio, pero el desempate se define igual— gana la
que se escribio despues.

**Que peso sale de un porcentaje.** El 75% de 140 son 105, pero el 72% son
100.8, y 100.8 kg no se pueden montar en ninguna barra del mundo. El peso
prescrito se redondea SIEMPRE al incremento real de ese ejercicio, que es el
salto minimo montable en ese gimnasio. Devolver el numero exacto seria
matematicamente correcto y practicamente inutil: el atleta tendria que
redondear de cabeza en cada serie, y cada uno redondearia distinto.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.math_utils import round_to
from app.models import OneRepMax

#: Limites de un porcentaje aceptable.
#:
#: Por abajo 30: menos que eso no es entrenamiento, es calentamiento con la
#: barra, y casi siempre es un cero de mas. Por arriba 110: los supramaximales
#: (excentricas, walkouts, soportes) existen y se programan por encima del
#: 100%, asi que cerrar en 100 seria cerrarle la puerta a trabajo real.
PERCENT_MIN = 30.0
PERCENT_MAX = 110.0


@dataclass(frozen=True)
class Mark:
    """La marca vigente de un ejercicio, lista para pintar o calcular."""

    value_kg: float
    achieved_on: str
    source: str


async def current_marks(session: AsyncSession, athlete_id: uuid.UUID) -> dict[uuid.UUID, Mark]:
    """Marca vigente de CADA ejercicio de este atleta, en una sola consulta.

    Se devuelve el mapa entero y no una marca suelta a proposito: pintar una
    tabla de doce ejercicios preguntando de uno en uno son doce viajes a la
    base por pantalla. Aqui es uno.
    """
    rows = await session.execute(
        select(OneRepMax)
        .where(OneRepMax.athlete_id == athlete_id)
        .order_by(
            OneRepMax.exercise_id,
            OneRepMax.achieved_on.asc(),
            OneRepMax.created_at.asc(),
        )
    )

    # Se recorre en orden ascendente y cada una pisa a la anterior, asi que al
    # final de cada ejercicio queda la mas reciente. Mas simple y mas barato
    # que un DISTINCT ON, que ademas no existe en SQLite.
    vigentes: dict[uuid.UUID, Mark] = {}
    for row in rows.scalars():
        vigentes[row.exercise_id] = Mark(
            value_kg=row.value_kg,
            achieved_on=row.achieved_on.isoformat(),
            source=row.source,
        )
    return vigentes


async def current_mark(
    session: AsyncSession, athlete_id: uuid.UUID, exercise_id: uuid.UUID
) -> Mark | None:
    """La marca vigente de un ejercicio, o None si nunca se registro ninguna."""
    marks = await current_marks(session, athlete_id)
    return marks.get(exercise_id)


def load_from_percent(one_rm_kg: float, percent: float, increment_kg: float) -> float:
    """Kilos montables para ese porcentaje de esa marca.

    Redondea al incremento del ejercicio. Ver el porque en el docstring del
    modulo.
    """
    return round_to(one_rm_kg * percent / 100.0, increment_kg)


def percent_from_load(one_rm_kg: float, load_kg: float) -> float:
    """El porcentaje que representa esa carga. Para pintar "102.5 kg · 73%".

    Se redondea a un decimal: mas precision es ruido, porque el propio peso ya
    viene redondeado al salto de la barra.
    """
    if one_rm_kg <= 0:
        return 0.0
    return round(load_kg / one_rm_kg * 100.0, 1)
