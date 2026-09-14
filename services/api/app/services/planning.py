"""Del esquema al motor, y vuelta.

Aqui vive la version de servidor de `resolvePlan` del cliente
(`apps/mobile/src/lib/prescription.ts`). La frase que resume el reparto de
autoridad sigue siendo la misma:

    el motor sugiere, el coach decide, el atleta ejecuta

El motor (`app/domain/`) es puro y no sabe que existe una base de datos. Este
modulo es el traductor: lee filas, construye los objetos que el motor espera,
aplica la prescripcion del coach encima y devuelve el plan.

Nada de esto hace commit. La unidad de trabajo la cierra el router.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.autoregulation import plan_exercise, plan_sets
from app.domain.math_utils import parse_leading_int, round6
from app.domain.schemas import (
    Aggressiveness,
    Exercise,
    ExercisePlan,
    Feedback,
    JointPain,
    LastPerformance,
    Pump,
    SetLogEntry,
    SetPlan,
    Soreness,
    WorkloadFeel,
)
from app.models import (
    DEFAULT_REST_SECONDS,
    ExerciseFeedback,
    MesocycleExercise,
    SessionExercise,
    SetLog,
    TrainingSession,
)

#: Feedback neutro para la primera semana, cuando todavia no hay historico.
#: Son los valores que NO disparan ninguna regla del motor: sin dolor, sin
#: agujetas, pump moderado y volumen justo. Asi la semana 1 sale del arranque
#: que puso el coach y de nada mas.
NEUTRAL_FEEDBACK = Feedback(
    joint=JointPain.NONE,
    soreness=Soreness.GONE_JUST_IN_TIME,
    pump=Pump.MODERATE,
    volume=WorkloadFeel.RIGHT,
)


async def last_performance(session: AsyncSession, mex: MesocycleExercise) -> LastPerformance:
    """Que hizo el atleta la ultima vez con este ejercicio.

    Se busca la sesion COMPLETADA mas reciente. Una sesion a medias no cuenta:
    progresar sobre un entrenamiento que el atleta abandono a la tercera serie
    subiria cargas por un dato que no representa lo que puede levantar.

    Si no hay historico, se devuelve el arranque que puso el coach con feedback
    neutro.
    """
    previous = await session.execute(
        select(SessionExercise)
        .join(TrainingSession)
        .where(
            SessionExercise.mesocycle_exercise_id == mex.id,
            TrainingSession.completed_at.is_not(None),
        )
        .order_by(TrainingSession.completed_at.desc())
        .limit(1)
        .options(
            selectinload(SessionExercise.set_logs),
            selectinload(SessionExercise.feedback),
        )
    )
    se = previous.scalar_one_or_none()

    if se is None:
        return LastPerformance(
            weight_kg=mex.starting_load_kg,
            reps=mex.starting_reps,
            rir=mex.target_rir,
            sets=mex.starting_sets,
            feedback=NEUTRAL_FEEDBACK,
        )

    done = [log for log in se.set_logs if log.done]
    fb = se.feedback

    # Se toma el PRIMER set completado como referencia de carga y reps: es el
    # menos contaminado por la fatiga acumulada dentro de la sesion, que es
    # justo lo que el motor modela aparte con el back-off.
    first = done[0] if done else None

    return LastPerformance(
        weight_kg=(
            first.weight_kg
            if first is not None and first.weight_kg is not None
            else se.planned_load_kg
        ),
        reps=reps_of(first) if first is not None else mex.starting_reps,
        rir=rir_of(first, mex.target_rir) if first is not None else mex.target_rir,
        sets=len(done) if done else se.planned_sets,
        feedback=(
            Feedback(
                joint=JointPain(fb.joint),
                soreness=Soreness(fb.soreness),
                pump=Pump(fb.pump),
                volume=WorkloadFeel(fb.volume),
            )
            if fb is not None
            else NEUTRAL_FEEDBACK
        ),
    )


def reps_of(log: SetLog) -> int:
    value = parse_leading_int(log.reps)
    return value if value > 0 else 1


def rir_of(log: SetLog, fallback: int) -> int:
    """El RPE que teclea el atleta se convierte a RIR: RIR = 10 - RPE.

    Si no lo registro, se asume que cerro en el RIR objetivo. Es la suposicion
    conservadora: no dispara ni subida por holgura ni castigo por pasarse.
    """
    if log.rpe is None or log.rpe.strip() == "":
        return fallback
    rpe = parse_leading_int(log.rpe)
    if rpe <= 0:
        return fallback
    return max(0, min(10, 10 - rpe))


def to_domain_exercise(
    mex: MesocycleExercise, last: LastPerformance, name: str, muscle: str, equipment: str
) -> Exercise:
    """Fila de la base -> objeto que entiende el motor."""
    return Exercise(
        id=str(mex.id),
        name=name,
        muscle=muscle,  # type: ignore[arg-type]
        equipment=equipment,
        rep_lo=mex.rep_lo,
        rep_hi=mex.rep_hi,
        target_rir=mex.target_rir,
        load_increment_kg=mex.load_increment_kg,
        last=last,
    )


def apply_prescription(exercise: Exercise, mex: MesocycleExercise) -> Exercise:
    """Rango y RIR del coach, si los puso.

    Se aplican ANTES de llamar al motor para que sus sugerencias ya respeten la
    prescripcion, en vez de calcular sobre un rango que el coach descarto.
    """
    p = mex.prescription
    if p is None:
        return exercise
    return exercise.model_copy(
        update={
            "rep_lo": p.rep_lo if p.rep_lo is not None else exercise.rep_lo,
            "rep_hi": p.rep_hi if p.rep_hi is not None else exercise.rep_hi,
            "target_rir": (p.target_rir if p.target_rir is not None else exercise.target_rir),
        }
    )


def resolve_plan(
    exercise: Exercise,
    mex: MesocycleExercise,
    aggressiveness: Aggressiveness,
) -> tuple[ExercisePlan, ExercisePlan]:
    """Devuelve (plan efectivo, sugerencia del motor).

    La sugerencia se conserva para que el coach vea al lado lo que el motor
    habria hecho por su cuenta. Sin eso, la pantalla de edicion no puede
    explicar por que un numero es distinto.
    """
    effective = apply_prescription(exercise, mex)
    suggestion = plan_exercise(effective, aggressiveness)

    p = mex.prescription
    if p is None or (p.sets is None and p.load_kg is None):
        return suggestion, suggestion

    load_kg = p.load_kg if p.load_kg is not None else suggestion.load_kg
    sets = p.sets if p.sets is not None else suggestion.sets

    plan = suggestion.model_copy(
        update={
            "load_kg": load_kg,
            "sets": sets,
            "delta_kg": round6(load_kg - exercise.last.weight_kg),
            "why": _why_from_coach(
                load_overridden=p.load_kg is not None,
                sets_overridden=p.sets is not None,
                engine_why=suggestion.why,
            ),
        }
    )
    return plan, suggestion


def _why_from_coach(*, load_overridden: bool, sets_overridden: bool, engine_why: str) -> str:
    """Mismo texto que muestra el cliente. Lo lee el atleta, no un log."""
    if load_overridden and sets_overridden:
        return "carga y volumen pautados por tu coach"
    if load_overridden:
        return "carga pautada por tu coach"
    if sets_overridden:
        return f"{engine_why} · volumen pautado por tu coach"
    return engine_why


def rest_seconds_for(mex: MesocycleExercise) -> int:
    """El descanso SIEMPRE lo pauta el coach: no tiene modo automatico."""
    return mex.prescription.rest_seconds if mex.prescription else DEFAULT_REST_SECONDS


def sets_for(exercise: Exercise, plan: ExercisePlan, logs: list[SetLog]) -> list[SetPlan]:
    """Objetivo set a set, recalculado con lo que el atleta ya registro hoy."""
    by_index: dict[int, SetLog] = {log.idx: log for log in logs}
    size = max(max(by_index) + 1, plan.sets) if by_index else plan.sets

    log_entries: list[SetLogEntry | None] = []
    for i in range(size):
        log = by_index.get(i)
        log_entries.append(
            SetLogEntry(
                weight_kg=log.weight_kg,
                reps=log.reps,
                rpe=log.rpe,
                sub_sets=log.sub_sets,
                done=log.done,
            )
            if log is not None
            else None
        )
    return plan_sets(exercise, plan, log_entries)


async def feedback_for(
    session: AsyncSession, session_exercise_id: uuid.UUID
) -> ExerciseFeedback | None:
    found = await session.execute(
        select(ExerciseFeedback).where(
            ExerciseFeedback.session_exercise_id == session_exercise_id
        )
    )
    return found.scalar_one_or_none()
