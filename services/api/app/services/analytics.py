"""El panel del coach, con datos reales.

Reemplaza `apps/mobile/src/data/clients.ts`, que eran los datos del prototipo
escritos a mano. Aqui se calculan de verdad: adherencia, progreso del bloque,
ultimas sesiones y alertas.

La division de trabajo es la de siempre: las REGLAS viven en
`app/domain/alerts.py` y son puras; este modulo solo lee filas y las convierte
en las estructuras que esas reglas esperan.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.alerts import (
    Alert,
    ExerciseHistory,
    alerts_for_exercise,
    alerts_for_mesocycle,
    estimate_e1rm,
)
from app.models import (
    ExerciseFeedback,
    Mesocycle,
    MesocycleExercise,
    MesocycleStatus,
    SessionExercise,
    SetLog,
    TrainingSession,
)
from app.services.planning import reps_of, rir_of


async def active_mesocycle(session: AsyncSession, athlete_id: uuid.UUID) -> Mesocycle | None:
    """El bloque en curso del atleta. El mas reciente si hay varios activos."""
    found = await session.execute(
        select(Mesocycle)
        .where(
            Mesocycle.athlete_id == athlete_id,
            Mesocycle.status == MesocycleStatus.ACTIVE.value,
        )
        .order_by(Mesocycle.created_at.desc())
        .limit(1)
    )
    return found.scalar_one_or_none()


async def session_counts(session: AsyncSession, mesocycle_id: uuid.UUID) -> tuple[int, int]:
    """(completadas, generadas). La adherencia sale de aqui.

    Se cuenta contra las sesiones GENERADAS, no contra las semanas del bloque:
    si el coach todavia no ha creado las de la semana que viene, no tiene
    sentido apuntarlas como faltas del atleta.
    """
    planned = await session.scalar(
        select(func.count(TrainingSession.id)).where(
            TrainingSession.mesocycle_id == mesocycle_id
        )
    )
    completed = await session.scalar(
        select(func.count(TrainingSession.id)).where(
            TrainingSession.mesocycle_id == mesocycle_id,
            TrainingSession.completed_at.is_not(None),
        )
    )
    return int(completed or 0), int(planned or 0)


async def exercise_histories(
    session: AsyncSession, mesocycle_id: uuid.UUID
) -> list[ExerciseHistory]:
    """Historial por ejercicio, ordenado de la sesion mas antigua a la mas nueva.

    Solo cuentan las sesiones CERRADAS. Una a medias no representa lo que el
    atleta puede levantar, y meterla en el historial dispararia alertas falsas.
    """
    found = await session.execute(
        select(SessionExercise, TrainingSession, MesocycleExercise)
        .join(TrainingSession, SessionExercise.session_id == TrainingSession.id)
        .join(
            MesocycleExercise,
            SessionExercise.mesocycle_exercise_id == MesocycleExercise.id,
        )
        .where(
            TrainingSession.mesocycle_id == mesocycle_id,
            TrainingSession.completed_at.is_not(None),
        )
        .order_by(TrainingSession.completed_at)
        .options(
            selectinload(SessionExercise.set_logs),
            selectinload(SessionExercise.feedback),
            selectinload(MesocycleExercise.catalog),
        )
    )

    grouped: dict[uuid.UUID, dict] = {}
    for se, _ts, mex in found.all():
        bucket = grouped.setdefault(
            mex.id,
            {
                "name": mex.catalog.name,
                "muscle": mex.catalog.muscle,
                "rir": [],
                "joint": [],
                "e1rm": [],
            },
        )
        bucket["rir"].append(_session_rir(se, mex.target_rir))
        bucket["joint"].append(_session_joint(se.feedback))
        bucket["e1rm"].append(_session_e1rm(se, mex.target_rir))

    return [
        ExerciseHistory(
            exercise_name=data["name"],
            muscle=data["muscle"],
            rir_by_session=tuple(data["rir"]),
            joint_by_session=tuple(data["joint"]),
            e1rm_by_session=tuple(data["e1rm"]),
        )
        for data in grouped.values()
    ]


def _first_done(se: SessionExercise) -> SetLog | None:
    """El primer set completado.

    Es la referencia menos contaminada por la fatiga acumulada dentro de la
    sesion, que el motor ya modela aparte con el back-off.
    """
    done = sorted((log for log in se.set_logs if log.done), key=lambda log: log.idx)
    return done[0] if done else None


def _session_rir(se: SessionExercise, fallback: int) -> int:
    log = _first_done(se)
    return rir_of(log, fallback) if log is not None else fallback


def _session_joint(feedback: ExerciseFeedback | None) -> str:
    return feedback.joint if feedback is not None else "Ninguno"


def _session_e1rm(se: SessionExercise, fallback_rir: int) -> float:
    log = _first_done(se)
    if log is None:
        return 0.0
    weight = log.weight_kg if log.weight_kg is not None else se.planned_load_kg
    return estimate_e1rm(weight, reps_of(log), rir_of(log, fallback_rir))


async def athlete_alerts(
    session: AsyncSession, athlete_id: uuid.UUID
) -> tuple[Mesocycle | None, list[Alert], int, int]:
    """Todo lo que la tarjeta del atleta necesita en el panel del coach."""
    meso = await active_mesocycle(session, athlete_id)
    if meso is None:
        return None, [], 0, 0

    completed, planned = await session_counts(session, meso.id)

    alerts: list[Alert] = []
    for history in await exercise_histories(session, meso.id):
        alerts.extend(alerts_for_exercise(history))
    alerts.extend(
        alerts_for_mesocycle(
            sessions_completed=completed,
            sessions_planned=planned,
            current_week_index=meso.current_week_index,
            total_weeks=meso.total_weeks,
        )
    )
    return meso, alerts, completed, planned


async def recent_sessions(
    session: AsyncSession, mesocycle_id: uuid.UUID, limit: int = 8
) -> list[TrainingSession]:
    found = await session.execute(
        select(TrainingSession)
        .where(TrainingSession.mesocycle_id == mesocycle_id)
        .order_by(TrainingSession.created_at.desc())
        .limit(limit)
    )
    return list(found.scalars())


async def session_volume(session: AsyncSession, session_id: uuid.UUID) -> tuple[int, float]:
    """(sets completados, tonelaje en kg) de una sesion.

    El tonelaje es la suma de peso x reps de cada set marcado. Es la metrica
    que el prototipo mostraba como "6.4 t".
    """
    found = await session.execute(
        select(SetLog)
        .join(SessionExercise, SetLog.session_exercise_id == SessionExercise.id)
        .where(SessionExercise.session_id == session_id, SetLog.done.is_(True))
    )
    sets = 0
    tonnage = 0.0
    for log in found.scalars():
        sets += 1
        if log.weight_kg is not None:
            tonnage += log.weight_kg * reps_of(log)
    return sets, round(tonnage, 1)
