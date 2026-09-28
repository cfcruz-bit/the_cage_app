"""Que dia toca y como se abre: la generacion de sesiones, en UN solo sitio.

Dos puertas llevan aqui, con permisos distintos: el coach genera la sesion de
su atleta (`POST /mesocycles/{id}/sessions`) y el atleta abre la suya
(`POST /sessions/next`). Las dos tienen que producir EXACTAMENTE lo mismo, o el
atleta acabaria entrenando con numeros distintos a los que ve el coach; por eso
la generacion (motor, congelado de cargas, `policy_version`, validacion de
marcas para los %) vive aqui y no se copia.

Las funciones lanzan `HTTPException` directamente: son la regla de negocio del
endpoint, no una libreria reutilizable, y traducir errores en dos routers
seria justo la copia que se quiere evitar.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.policy import POLICY_VERSION
from app.domain.schemas import Aggressiveness
from app.models import (
    Mesocycle,
    MesocycleDay,
    MesocycleExercise,
    MesocycleStatus,
    SessionExercise,
    TrainingSession,
)
from app.services.planning import (
    FIRST_SESSION_WHY,
    effective_prescription,
    last_performance,
    resolve_backoff,
    resolve_plan,
    resolve_without_history,
    to_domain_exercise,
)
from app.services.records import current_marks


@dataclass(frozen=True)
class NextUp:
    week_number: int
    day_number: int
    day_name: str | None


async def open_session(session: AsyncSession, athlete_id: uuid.UUID) -> TrainingSession | None:
    """La sesion mas reciente del atleta que sigue sin cerrar."""
    found = await session.execute(
        select(TrainingSession)
        .join(Mesocycle, TrainingSession.mesocycle_id == Mesocycle.id)
        .where(Mesocycle.athlete_id == athlete_id, TrainingSession.completed_at.is_(None))
        .order_by(TrainingSession.created_at.desc())
        .limit(1)
    )
    return found.scalar_one_or_none()


async def active_mesocycle(session: AsyncSession, athlete_id: uuid.UUID) -> Mesocycle | None:
    """El bloque en el que esta el atleta: el activo mas reciente."""
    found = await session.execute(
        select(Mesocycle)
        .where(Mesocycle.athlete_id == athlete_id, Mesocycle.status == MesocycleStatus.ACTIVE)
        .order_by(Mesocycle.created_at.desc())
        .limit(1)
    )
    return found.scalar_one_or_none()


async def day_names(session: AsyncSession, mesocycle_id: uuid.UUID) -> dict[int, str]:
    found = await session.execute(
        select(MesocycleDay.day_number, MesocycleDay.name).where(
            MesocycleDay.mesocycle_id == mesocycle_id
        )
    )
    return {n: name for n, name in found.all()}


async def next_up(session: AsyncSession, meso: Mesocycle) -> NextUp | None:
    """Que dia le toca al atleta, o None si ya termino el bloque.

    La semana en curso es la del ultimo dia COMPLETADO (la 1 si no hay
    ninguno). En ella se ofrece el dia mas bajo sin completar: un dia saltado
    se sigue ofreciendo hasta que se haga o hasta que se complete algo de una
    semana posterior. Solo cuando la semana esta entera hecha se pasa a la
    siguiente, y pasarse de `total_weeks` es el fin del bloque.
    """
    found = await session.execute(
        select(TrainingSession.week_number, TrainingSession.day_number).where(
            TrainingSession.mesocycle_id == meso.id,
            TrainingSession.completed_at.is_not(None),
        )
    )
    done = {(w, d) for w, d in found.all()}

    week = max((w for w, _ in done), default=1)
    while week <= meso.total_weeks:
        for day in range(1, meso.days_per_week + 1):
            if (week, day) not in done:
                names = await day_names(session, meso.id)
                return NextUp(week, day, names.get(day))
        week += 1
    return None


async def generate_session(
    session: AsyncSession,
    meso: Mesocycle,
    week_number: int,
    day_number: int,
    day_label: str | None = None,
) -> tuple[TrainingSession, bool]:
    """Genera la sesion de ese dia con el motor y la CONGELA.

    Congelar es la parte importante: carga, sets y `policy_version` quedan
    escritos. No se recalculan al leer. Si manana cambian las reglas, esta
    sesion sigue contando lo que de verdad se entreno.

    Si ese dia ya tiene una sesion SIN cerrar en esa semana, devuelve esa en
    vez de crear otra: quien la pide solo quiere abrirla. El bool dice si se
    creo ahora. No hace commit: lo hace el endpoint.
    """
    if week_number > meso.total_weeks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esa semana esta fuera del mesociclo",
        )
    if day_number > meso.days_per_week:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El dia {day_number} no existe: el mesociclo tiene {meso.days_per_week}",
        )

    found = await session.execute(
        select(TrainingSession).where(
            TrainingSession.mesocycle_id == meso.id,
            TrainingSession.week_number == week_number,
            TrainingSession.day_number == day_number,
            TrainingSession.completed_at.is_(None),
        )
    )
    abierta = found.scalars().first()
    if abierta is not None:
        return abierta, False

    label = day_label or (await day_names(session, meso.id)).get(day_number)
    ts = TrainingSession(
        mesocycle_id=meso.id,
        week_number=week_number,
        day_number=day_number,
        day_label=label or f"Día {day_number}",
        is_deload=week_number == meso.total_weeks,
        started_at=datetime.now(UTC),
    )
    session.add(ts)
    await session.flush()

    found_mex = await session.execute(
        select(MesocycleExercise)
        .where(
            MesocycleExercise.mesocycle_id == meso.id,
            MesocycleExercise.day_number == day_number,
        )
        .order_by(MesocycleExercise.position)
        .options(
            selectinload(MesocycleExercise.catalog),
            selectinload(MesocycleExercise.prescriptions),
        )
    )
    mexs = list(found_mex.scalars())
    aggressiveness = Aggressiveness(meso.aggressiveness)
    marks = await current_marks(session, meso.athlete_id)

    # Se valida ANTES de generar nada: si un ejercicio pautado por % no tiene
    # marca, la sesion no se genera a medias con el resto de ejercicios ya
    # escritos. Como aun no hubo commit, el rollback de `get_session` deshace
    # tambien la fila de `ts` de arriba.
    for mex in mexs:
        p = effective_prescription(mex, week_number)
        if p is None or mex.catalog_id in marks:
            continue
        for pct in (p.load_percent, p.backoff_load_percent):
            if pct is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Falta la marca de {mex.catalog.name} para calcular el {pct:g}%",
                )

    for mex in mexs:
        last = await last_performance(session, mex)
        mark = marks.get(mex.catalog_id)
        one_rm_kg = mark.value_kg if mark is not None else None
        # Ya validado arriba: si lleva back-off, sus kilos estan resueltos.
        backoff = resolve_backoff(
            effective_prescription(mex, week_number), one_rm_kg, mex.load_increment_kg
        )
        frozen_backoff = {
            "backoff_sets": backoff[0] if backoff else None,
            "backoff_reps": backoff[1] if backoff else None,
            "backoff_load_kg": backoff[2] if backoff else None,
        }

        if last is None:
            # Sin ningun peso previo el motor no tiene de donde partir. Si el
            # coach fijo uno para esta semana (kg o %) se usa directo; si no,
            # el ejercicio sale en blanco y el atleta escribe el suyo.
            load_kg, sets = resolve_without_history(mex, week_number, one_rm_kg)
            session.add(
                SessionExercise(
                    session_id=ts.id,
                    mesocycle_exercise_id=mex.id,
                    position=mex.position,
                    planned_load_kg=load_kg,
                    planned_sets=sets,
                    policy_version=POLICY_VERSION,
                    why=FIRST_SESSION_WHY if load_kg is None else "carga pautada por tu coach",
                    **frozen_backoff,
                )
            )
            continue

        exercise = to_domain_exercise(
            mex, last, mex.catalog.name, mex.catalog.muscle, mex.catalog.equipment
        )
        plan, _suggestion = resolve_plan(
            exercise, mex, aggressiveness, week_number, one_rm_kg=one_rm_kg
        )

        session.add(
            SessionExercise(
                session_id=ts.id,
                mesocycle_exercise_id=mex.id,
                position=mex.position,
                planned_load_kg=plan.load_kg,
                planned_sets=plan.sets,
                policy_version=plan.policy_version,
                why=plan.why,
                **frozen_backoff,
            )
        )

    return ts, True
