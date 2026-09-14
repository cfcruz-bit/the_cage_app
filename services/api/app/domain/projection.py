"""Proyección del mesociclo.

Port de `packages/engine/src/projection.ts`. Solo la parte numérica: el color y
el formato son decisión del cliente.

La semana actual es el plan real que devuelve `plan_exercise`; las anteriores y
posteriores se extrapolan en saltos de un incremento, y la última es el deload.
"""

from __future__ import annotations

from typing import Final

from app.domain.math_utils import clamp_int, js_round, round_to
from app.domain.policy import MIN_HARD_SETS
from app.domain.schemas import (
    Exercise,
    ExercisePlan,
    ProjectedWeek,
    ProjectionOptions,
)

#: Porcentaje de la carga que se mantiene en la semana de deload.
DELOAD_LOAD_FACTOR: Final[float] = 0.75
#: Hard sets durante el deload.
DELOAD_SETS: Final[int] = 2
#: RIR objetivo durante el deload: muy lejos del fallo.
DELOAD_RIR: Final[int] = 4


def project_mesocycle(
    exercise: Exercise,
    plan: ExercisePlan,
    options: ProjectionOptions | None = None,
) -> list[ProjectedWeek]:
    """Extrapola la progresión de un ejercicio a lo largo del mesociclo."""
    opts = options or ProjectionOptions()
    total_weeks = opts.total_weeks
    current = opts.current_week_index
    last_index = total_weeks - 1

    weeks: list[ProjectedWeek] = []

    for i in range(total_weeks):
        if i == last_index:
            load_kg = round_to(plan.load_kg * DELOAD_LOAD_FACTOR, exercise.load_increment_kg)
            weeks.append(
                ProjectedWeek(
                    index=i,
                    week_number=None,
                    is_deload=True,
                    sets=DELOAD_SETS,
                    rep_lo=exercise.rep_lo,
                    rep_hi=exercise.rep_lo,
                    load_kg=load_kg,
                    target_rir=DELOAD_RIR,
                    intensity_ratio=_ratio(load_kg, plan.e1rm),
                )
            )
            continue

        offset = i - current
        load_kg = round_to(
            plan.load_kg + offset * exercise.load_increment_kg,
            exercise.load_increment_kg,
        )
        weeks.append(
            ProjectedWeek(
                index=i,
                week_number=i + 1,
                is_deload=False,
                sets=clamp_int(plan.sets + offset, MIN_HARD_SETS, plan.sets + 2),
                rep_lo=exercise.rep_lo,
                rep_hi=exercise.rep_hi,
                load_kg=load_kg,
                target_rir=clamp_int(3 - int(i * 0.6), 0, 3),
                intensity_ratio=_ratio(load_kg, plan.e1rm),
            )
        )

    return weeks


def _ratio(load_kg: float, reference: float) -> float:
    base = reference or load_kg
    return js_round((load_kg / base) * 1e4) / 1e4
