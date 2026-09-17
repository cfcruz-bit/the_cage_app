"""Sesiones de entrenamiento: generar el plan, registrar sets, dar feedback.

Reparto de autoridad en este archivo:

- **Generar** una sesion: el coach. Es donde el motor decide carga y volumen.
- **Registrar sets** y **dar feedback**: el atleta (su coach tambien puede,
  para corregir un registro).
- **Cerrar** la sesion: cualquiera de los dos.

El atleta NO puede cambiar carga, sets, reps ni descanso. Marca lo hecho y
reporta como fue; eso es todo lo que el producto le concede.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import (
    NO_ENCONTRADO,
    ActiveUser,
    SessionDep,
    coach_leads_athlete,
)
from app.api.dto import (
    FeedbackIn,
    PlannedSetOut,
    SessionCreate,
    SessionExerciseOut,
    SessionOut,
    SetLogBatch,
    SyncResult,
)
from app.domain.schemas import Aggressiveness
from app.models import (
    ExerciseFeedback,
    Mesocycle,
    MesocycleExercise,
    SessionExercise,
    SetLog,
    TrainingSession,
    UserRole,
)
from app.services.planning import (
    last_performance,
    resolve_plan,
    rest_seconds_for,
    sets_for,
    to_domain_exercise,
)

router = APIRouter(tags=["sessions"])


async def _readable_session(
    session_id: uuid.UUID, session: SessionDep, user: ActiveUser
) -> TrainingSession:
    ts = await session.get(TrainingSession, session_id)
    if ts is None:
        raise NO_ENCONTRADO

    meso = await session.get(Mesocycle, ts.mesocycle_id)
    if meso is None:
        raise NO_ENCONTRADO

    if user.role == UserRole.ATHLETE:
        if meso.athlete_id != user.id:
            raise NO_ENCONTRADO
    elif not await coach_leads_athlete(session, user.id, meso.athlete_id):
        raise NO_ENCONTRADO

    return ts


ReadableSession = Annotated[TrainingSession, Depends(_readable_session)]


@router.post(
    "/mesocycles/{mesocycle_id}/sessions",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(
    mesocycle_id: uuid.UUID,
    body: SessionCreate,
    session: SessionDep,
    user: ActiveUser,
) -> SessionOut:
    """Genera la sesion del dia con el motor y la CONGELA.

    Congelar es la parte importante: carga, sets y `policy_version` quedan
    escritos. No se recalculan al leer. Si manana cambian las reglas, esta
    sesion sigue contando lo que de verdad se entreno.
    """
    meso = await session.get(Mesocycle, mesocycle_id)
    if meso is None:
        raise NO_ENCONTRADO
    if user.role != UserRole.COACH or not await coach_leads_athlete(
        session, user.id, meso.athlete_id
    ):
        raise NO_ENCONTRADO
    if body.week_number > meso.total_weeks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esa semana esta fuera del mesociclo",
        )

    ts = TrainingSession(
        mesocycle_id=meso.id,
        week_number=body.week_number,
        day_label=body.day_label,
        is_deload=body.week_number == meso.total_weeks,
        started_at=datetime.now(UTC),
    )
    session.add(ts)
    await session.flush()

    found = await session.execute(
        select(MesocycleExercise)
        .where(MesocycleExercise.mesocycle_id == meso.id)
        .order_by(MesocycleExercise.position)
        .options(
            selectinload(MesocycleExercise.catalog),
            selectinload(MesocycleExercise.prescriptions),
        )
    )
    aggressiveness = Aggressiveness(meso.aggressiveness)

    for mex in found.scalars():
        last = await last_performance(session, mex)
        exercise = to_domain_exercise(
            mex, last, mex.catalog.name, mex.catalog.muscle, mex.catalog.equipment
        )
        plan, _suggestion = resolve_plan(exercise, mex, aggressiveness, body.week_number)

        session.add(
            SessionExercise(
                session_id=ts.id,
                mesocycle_exercise_id=mex.id,
                position=mex.position,
                planned_load_kg=plan.load_kg,
                planned_sets=plan.sets,
                policy_version=plan.policy_version,
                why=plan.why,
            )
        )

    await session.commit()
    return await _render(session, ts.id)


@router.get("/sessions/current", response_model=SessionOut | None)
async def current_session(
    session: SessionDep,
    user: ActiveUser,
    # El alias es obligatorio: los parametros de consulta NO pasan por el
    # alias_generator de los DTO, asi que sin esto `athleteId` no se enlaza y
    # llega None en silencio.
    athlete_id: Annotated[uuid.UUID | None, Query(alias="athleteId")] = None,
) -> SessionOut | None:
    """La sesion abierta del atleta, si la hay.

    Es lo primero que pide el movil al abrir la pestana de entreno. Devuelve
    `null` y no 404 cuando no hay ninguna: "hoy no te toca" es una respuesta
    normal del producto, no un error, y un 404 obligaria a cada pantalla a
    distinguir entre "no hay sesion" y "algo se rompio".

    Se busca la mas reciente SIN cerrar. Una sesion cerrada ya no se entrena;
    se consulta desde el historial.
    """
    target = user.id
    if user.role == UserRole.COACH:
        if athlete_id is None:
            return None
        if not await coach_leads_athlete(session, user.id, athlete_id):
            raise NO_ENCONTRADO
        target = athlete_id

    found = await session.execute(
        select(TrainingSession)
        .join(Mesocycle, TrainingSession.mesocycle_id == Mesocycle.id)
        .where(
            Mesocycle.athlete_id == target,
            TrainingSession.completed_at.is_(None),
        )
        .order_by(TrainingSession.created_at.desc())
        .limit(1)
    )
    ts = found.scalar_one_or_none()
    if ts is None:
        return None
    return await _render(session, ts.id)


@router.get("/sessions/{session_id}", response_model=SessionOut)
async def get_session(ts: ReadableSession, session: SessionDep) -> SessionOut:
    return await _render(session, ts.id)


@router.post("/sessions/{session_id}/sets", response_model=SyncResult)
async def log_sets(body: SetLogBatch, ts: ReadableSession, session: SessionDep) -> SyncResult:
    """Registra sets. **Idempotente por `clientId`.**

    Este es el endpoint que vacia la cola del telefono. El atleta entrena sin
    cobertura y la cola reintenta; el mismo `clientId` reenviado tres veces
    tiene que seguir siendo una fila, o el motor subiria cargas por sets que
    nunca ocurrieron.
    """
    valid = await session.execute(
        select(SessionExercise.id).where(SessionExercise.session_id == ts.id)
    )
    allowed = set(valid.scalars())

    incoming = {item.session_exercise_id for item in body.sets}
    if not incoming.issubset(allowed):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hay sets que no pertenecen a esta sesion",
        )

    client_ids = [item.client_id for item in body.sets]
    existing = await session.execute(select(SetLog).where(SetLog.client_id.in_(client_ids)))
    by_client = {row.client_id: row for row in existing.scalars()}

    updated: list[str] = []
    for item in body.sets:
        row = by_client.get(item.client_id)
        if row is None:
            row = SetLog(
                client_id=item.client_id,
                session_exercise_id=item.session_exercise_id,
                idx=item.index,
            )
            session.add(row)
        else:
            updated.append(item.client_id)

        row.weight_kg = item.weight_kg
        row.reps = item.reps
        row.rpe = item.rpe
        row.sub_sets = item.sub_sets
        row.done = item.done
        row.logged_at = item.logged_at or datetime.now(UTC)

    await session.commit()
    return SyncResult(accepted=len(body.sets), updated=updated)


@router.post("/sessions/{session_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
async def save_feedback(body: FeedbackIn, ts: ReadableSession, session: SessionDep) -> None:
    """Feedback subjetivo del ejercicio. Es lo que alimenta a la semana que viene."""
    se = await session.get(SessionExercise, body.session_exercise_id)
    if se is None or se.session_id != ts.id:
        raise NO_ENCONTRADO

    found = await session.execute(
        select(ExerciseFeedback).where(ExerciseFeedback.session_exercise_id == se.id)
    )
    row = found.scalar_one_or_none()
    if row is None:
        row = ExerciseFeedback(session_exercise_id=se.id)
        session.add(row)

    row.joint = body.feedback.joint.value
    row.soreness = body.feedback.soreness.value
    row.pump = body.feedback.pump.value
    row.volume = body.feedback.volume.value
    await session.commit()


@router.post("/sessions/{session_id}/complete", response_model=SessionOut)
async def complete_session(ts: ReadableSession, session: SessionDep) -> SessionOut:
    """Cierra la sesion. Solo entonces cuenta como historico para el motor."""
    if ts.completed_at is None:
        ts.completed_at = datetime.now(UTC)
        if ts.started_at is None:
            ts.started_at = ts.completed_at
        await session.commit()
    return await _render(session, ts.id)


async def _render(session: SessionDep, session_id: uuid.UUID) -> SessionOut:
    """Monta la respuesta: plan congelado + objetivos set a set recalculados.

    Los objetivos por set SI se recalculan en cada lectura, y es correcto: el
    back-off depende de lo que el atleta acaba de registrar hace diez segundos.
    Lo que no se recalcula es el plan del ejercicio.
    """
    found = await session.execute(
        select(TrainingSession)
        .where(TrainingSession.id == session_id)
        .options(
            selectinload(TrainingSession.exercises).selectinload(SessionExercise.set_logs),
        )
    )
    ts = found.scalar_one()
    meso = await session.get(Mesocycle, ts.mesocycle_id)
    assert meso is not None

    out: list[SessionExerciseOut] = []
    for se in ts.exercises:
        mex_found = await session.execute(
            select(MesocycleExercise)
            .where(MesocycleExercise.id == se.mesocycle_exercise_id)
            .options(
                selectinload(MesocycleExercise.catalog),
                selectinload(MesocycleExercise.prescriptions),
            )
        )
        mex = mex_found.scalar_one()

        last = await last_performance(session, mex)
        exercise = to_domain_exercise(
            mex, last, mex.catalog.name, mex.catalog.muscle, mex.catalog.equipment
        )
        # El plan sale de la fila, NO se vuelve a pedir al motor.
        plan = _frozen_plan(se, exercise)
        planned = sets_for(exercise, plan, list(se.set_logs))

        out.append(
            SessionExerciseOut(
                id=se.id,
                position=se.position,
                name=mex.catalog.name,
                muscle=mex.catalog.muscle,
                planned_load_kg=se.planned_load_kg,
                planned_sets=se.planned_sets,
                rest_seconds=rest_seconds_for(mex, ts.week_number),
                policy_version=se.policy_version,
                why=se.why,
                exercise=exercise,
                sets=[
                    PlannedSetOut(
                        index=s.index,
                        target_weight_kg=s.target_weight_kg,
                        target_reps=s.target_reps,
                        why=s.why,
                        logged_weight_kg=s.logged_weight_kg,
                        logged_reps=s.logged_reps,
                        logged_rpe=s.logged_rpe,
                        done=s.done,
                    )
                    for s in planned
                ],
            )
        )

    return SessionOut(
        id=ts.id,
        mesocycle_id=ts.mesocycle_id,
        week_number=ts.week_number,
        day_label=ts.day_label,
        is_deload=ts.is_deload,
        started_at=ts.started_at,
        completed_at=ts.completed_at,
        exercises=out,
    )


def _frozen_plan(se: SessionExercise, exercise):  # type: ignore[no-untyped-def]
    """Reconstruye el ExercisePlan a partir de lo que se guardo."""
    from app.domain.math_utils import clamp, e1rm, round6
    from app.domain.schemas import ExercisePlan

    return ExercisePlan(
        load_kg=se.planned_load_kg,
        sets=se.planned_sets,
        delta_kg=round6(se.planned_load_kg - exercise.last.weight_kg),
        set_note=None,
        add_reason="",
        why=se.why,
        e1rm=e1rm(exercise.last.weight_kg, exercise.last.reps, exercise.last.rir),
        e1rm_next=e1rm(
            se.planned_load_kg,
            clamp(exercise.last.reps, exercise.rep_lo, exercise.rep_hi),
            exercise.target_rir,
        ),
        policy_version=se.policy_version,
    )
