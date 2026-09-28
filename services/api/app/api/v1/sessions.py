"""Sesiones de entrenamiento: generar el plan, registrar sets, dar feedback.

Reparto de autoridad en este archivo:

- **Generar** una sesion: el coach (`POST /mesocycles/{id}/sessions`) o el atleta
  abriendo SU dia (`POST /sessions/next`). Es donde el motor decide carga y
  volumen; las dos puertas comparten `app.services.schedule.generate_session`.
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

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import (
    NO_ENCONTRADO,
    SOLO_ATLETA,
    ActiveUser,
    SessionDep,
    coach_leads_athlete,
)
from app.api.dto import (
    CurrentSessionOut,
    FeedbackIn,
    NextUpOut,
    PlannedSetOut,
    SessionCreate,
    SessionExerciseOut,
    SessionOut,
    SetLogBatch,
    SyncResult,
)
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
    apply_prescription,
    last_performance,
    rest_seconds_for,
    sets_for,
    to_domain_exercise,
)
from app.services.schedule import (
    active_mesocycle,
    generate_session,
    next_up,
    open_session,
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
    response: Response,
    session: SessionDep,
    user: ActiveUser,
) -> SessionOut:
    """El coach genera la sesion de un dia de su atleta.

    Si ese dia ya tiene una sesion sin cerrar en esa semana la devuelve (200) en
    vez de crear una segunda: el coach solo quiere abrirla. La generacion en si
    esta en `app.services.schedule`, compartida con `POST /sessions/next`.
    """
    meso = await session.get(Mesocycle, mesocycle_id)
    if meso is None:
        raise NO_ENCONTRADO
    if user.role != UserRole.COACH or not await coach_leads_athlete(
        session, user.id, meso.athlete_id
    ):
        raise NO_ENCONTRADO

    ts, created = await generate_session(
        session, meso, body.week_number, body.day_number, body.day_label
    )
    await session.commit()
    if not created:
        response.status_code = status.HTTP_200_OK
    return await _render(session, ts.id)


@router.post("/sessions/next", response_model=SessionOut)
async def open_next_session(
    response: Response, session: SessionDep, user: ActiveUser
) -> SessionOut:
    """El atleta abre SU dia, sin esperar a que nadie se lo genere.

    No recibe atleta, semana ni dia: los tres salen de `next_up`, calculado en
    el servidor. Un endpoint que los aceptara seria uno donde el atleta elige
    que entrenar. Tampoco escribe el plan: abre el dia que el coach ya pauto.
    Pasa por `ActiveUser`, asi que con la membresia vencida da 402 como todo.
    """
    if user.role != UserRole.ATHLETE:
        raise SOLO_ATLETA

    abierta = await open_session(session, user.id)
    if abierta is not None:
        return await _render(session, abierta.id)

    meso = await active_mesocycle(session, user.id)
    nxt = await next_up(session, meso) if meso is not None else None
    if meso is None or nxt is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No tienes ningun dia pendiente: tu mesociclo ya esta completado",
        )

    ts, _ = await generate_session(session, meso, nxt.week_number, nxt.day_number)
    await session.commit()
    response.status_code = status.HTTP_201_CREATED
    return await _render(session, ts.id)


@router.get("/sessions/current", response_model=CurrentSessionOut)
async def current_session(
    session: SessionDep,
    user: ActiveUser,
    # El alias es obligatorio: los parametros de consulta NO pasan por el
    # alias_generator de los DTO, asi que sin esto `athleteId` no se enlaza y
    # llega None en silencio.
    athlete_id: Annotated[uuid.UUID | None, Query(alias="athleteId")] = None,
) -> CurrentSessionOut:
    """La sesion abierta del atleta y, si no hay ninguna, que dia toca abrir.

    Es lo primero que pide el movil al abrir la pestana de entreno. Devuelve
    `session: null` y no 404 cuando no hay ninguna abierta: "hoy no te toca" es
    una respuesta normal del producto, y un 404 obligaria a cada pantalla a
    distinguir entre "no hay sesion" y "algo se rompio".

    Se busca la mas reciente SIN cerrar. Con una abierta, `next` es null: lo que
    toca es terminar esa. Sin ninguna, `next` sale de `next_up`, y `finished`
    avisa de que el atleta tiene bloque pero ya no le queda ningun dia.
    """
    target = user.id
    if user.role == UserRole.COACH:
        if athlete_id is None:
            return CurrentSessionOut(session=None, next=None)
        if not await coach_leads_athlete(session, user.id, athlete_id):
            raise NO_ENCONTRADO
        target = athlete_id

    ts = await open_session(session, target)
    if ts is not None:
        return CurrentSessionOut(session=await _render(session, ts.id), next=None)

    meso = await active_mesocycle(session, target)
    if meso is None:
        return CurrentSessionOut(session=None, next=None)
    nxt = await next_up(session, meso)
    return CurrentSessionOut(
        session=None,
        next=NextUpOut(
            week_number=nxt.week_number, day_number=nxt.day_number, day_name=nxt.day_name
        )
        if nxt is not None
        else None,
        finished=nxt is None,
    )


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

        if se.planned_load_kg is None:
            # Se congelo sin ningun peso: no hay motor que ejecutar ni
            # objetivos que calcular. Las series salen en blanco y el atleta
            # escribe lo suyo; lo ya registrado se sigue mostrando igual.
            out.append(
                SessionExerciseOut(
                    id=se.id,
                    position=se.position,
                    name=mex.catalog.name,
                    muscle=mex.catalog.muscle,
                    planned_load_kg=None,
                    planned_sets=se.planned_sets,
                    rest_seconds=rest_seconds_for(mex, ts.week_number),
                    policy_version=se.policy_version,
                    why=se.why,
                    exercise=None,
                    sets=_blank_sets(se),
                )
            )
            continue

        last = await last_performance(session, mex)
        # Si esta fila tiene un peso congelado, tuvo que haber un ultimo peso
        # cuando se genero, y el historico solo crece: sigue habiendolo.
        assert last is not None, "una fila con peso congelado no puede quedarse sin historico"
        # Con el rango y el RIR de ESTA semana: sin esto las series salian con
        # las reps base del ejercicio aunque el coach pautara otras.
        exercise = apply_prescription(
            to_domain_exercise(
                mex, last, mex.catalog.name, mex.catalog.muscle, mex.catalog.equipment
            ),
            mex,
            ts.week_number,
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
        day_number=ts.day_number,
        day_label=ts.day_label,
        is_deload=ts.is_deload,
        started_at=ts.started_at,
        completed_at=ts.completed_at,
        exercises=out,
    )


def _blank_sets(se: SessionExercise) -> list[PlannedSetOut]:
    """Las series de un ejercicio sin ningun peso, con lo ya registrado."""
    by_index = {log.idx: log for log in se.set_logs}
    size = max(max(by_index) + 1, se.planned_sets) if by_index else se.planned_sets

    out: list[PlannedSetOut] = []
    for i in range(size):
        log = by_index.get(i)
        out.append(
            PlannedSetOut(
                index=i,
                target_weight_kg=None,
                target_reps=None,
                why="",
                logged_weight_kg=log.weight_kg if log is not None else None,
                logged_reps=log.reps if log is not None else None,
                logged_rpe=log.rpe if log is not None else None,
                done=bool(log.done) if log is not None else False,
            )
        )
    return out


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
