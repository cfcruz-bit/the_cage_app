"""Motor de autorregulación — implementación de referencia del servidor.

Port de `packages/engine/src/autoregulation.ts`, regla por regla. El cliente
calcula lo mismo para responder al instante sin señal, pero **este es el que
manda**: lo que se persiste y lo que ve el coach sale de aquí.

Las funciones son puras: reciben datos y devuelven datos. No tocan la base, no
tocan HTTP, no formatean unidades. Por eso se pueden testear sin levantar nada,
y por eso el test de contrato puede recorrer 1 764 casos en dos segundos.

Si un número de aquí no cuadra con el de TypeScript, es un bug de este archivo.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.domain.math_utils import (
    clamp,
    clamp_int,
    e1rm,
    js_round,
    parse_leading_int,
    round6,
    round_to,
)
from app.domain.policy import (
    AGGRESSIVENESS_FACTOR,
    AT_LIMIT_MAX_STEPS,
    JOINT_PAIN_LOAD_FACTOR,
    MIN_HARD_SETS,
    POLICY_VERSION,
    REASON_SEPARATOR,
    SET_NOTE_ADD,
    SET_NOTE_REMOVE,
    Reasons,
)
from app.domain.schemas import (
    Aggressiveness,
    Exercise,
    ExercisePlan,
    Feedback,
    JointPain,
    Pump,
    SetLogEntry,
    SetPlan,
    Soreness,
    WorkloadFeel,
)


def plan_exercise(
    exercise: Exercise,
    aggressiveness: Aggressiveness,
    feedback_override: Feedback | None = None,
) -> ExercisePlan:
    """Decide carga y hard sets del ejercicio para esta semana.

    El orden de las reglas importa:

    1. Holgura de RIR y tope de reps acumulan "pasos" de subida.
    2. El feedback de volumen/pump ajusta el número de sets.
    3. "Al límite" tapa los pasos; "Demasiado" quita un set.
    4. Se calcula la carga con los pasos ya multiplicados por la agresividad.
    5. Dolor articular severo y soreness persistente SOBRESCRIBEN todo lo
       anterior, incluidas las explicaciones acumuladas.

    Args:
        exercise: Prescripción + rendimiento de la última sesión.
        aggressiveness: Preferencia del atleta.
        feedback_override: Feedback hipotético, para el preview en vivo del
            bottom sheet. Si es None, usa el feedback real.
    """
    last = exercise.last
    fb = feedback_override or last.feedback
    factor = AGGRESSIVENESS_FACTOR[aggressiveness]

    why: list[str] = []
    steps = 0

    # 1. Señales de progresión.
    slack = last.rir - exercise.target_rir
    if slack > 0:
        steps += slack
        why.append(Reasons.rir_slack(last.rir, exercise.target_rir))
    if last.reps >= exercise.rep_hi:
        steps += 1
        why.append(Reasons.rep_ceiling(exercise.rep_hi))
    if slack < 0:
        why.append(Reasons.RIR_OVERSHOOT)

    # 2 y 3. Ajuste de volumen por feedback subjetivo.
    sets = last.sets
    set_note: str | None = None
    add_reason = ""

    if fb.volume is WorkloadFeel.NOT_ENOUGH:
        sets = last.sets + 1
        set_note = SET_NOTE_ADD
        add_reason = Reasons.VOLUME_INSUFFICIENT
    elif fb.pump is Pump.LOW:
        sets = last.sets + 1
        set_note = SET_NOTE_ADD
        add_reason = Reasons.LOW_PUMP

    if fb.volume is WorkloadFeel.AT_LIMIT:
        steps = min(steps, AT_LIMIT_MAX_STEPS)
    if fb.volume is WorkloadFeel.TOO_MUCH:
        sets = max(MIN_HARD_SETS, last.sets - 1)
        set_note = SET_NOTE_REMOVE

    # 4. Carga resultante.
    load_kg = round_to(
        last.weight_kg + js_round(steps * factor) * exercise.load_increment_kg,
        exercise.load_increment_kg,
    )

    # 5. Vetos por dolor. Sobrescriben carga, sets y explicación.
    if fb.joint is JointPain.SEVERE:
        load_kg = round_to(last.weight_kg * JOINT_PAIN_LOAD_FACTOR, exercise.load_increment_kg)
        sets = max(MIN_HARD_SETS, sets - 1)
        set_note = SET_NOTE_REMOVE
        why = [Reasons.JOINT_PAIN]
    elif fb.soreness is Soreness.STILL_SORE:
        load_kg = last.weight_kg
        why = [Reasons.STILL_SORE]

    if not why:
        why.append(Reasons.NO_SIGNAL)

    return ExercisePlan(
        load_kg=load_kg,
        sets=sets,
        delta_kg=round6(load_kg - last.weight_kg),
        set_note=set_note,
        add_reason=add_reason,
        why=REASON_SEPARATOR.join(why),
        e1rm=e1rm(last.weight_kg, last.reps, last.rir),
        e1rm_next=e1rm(
            load_kg,
            clamp(last.reps, exercise.rep_lo, exercise.rep_hi),
            exercise.target_rir,
        ),
        policy_version=POLICY_VERSION,
    )


def plan_sets(
    exercise: Exercise,
    plan: ExercisePlan,
    log: Sequence[SetLogEntry | None] = (),
) -> list[SetPlan]:
    """Reparte el plan semanal set a set, con lo que el atleta ya registró hoy.

    Reglas a partir del segundo set:

    - El set anterior cayó por debajo del rango → back-off de un incremento.
    - Superó el tope del rango → sube un incremento.
    - Quedó dentro → misma carga, una rep menos por fatiga.
    - No está registrado → se asume caída de ~1 rep.
    """
    out: list[SetPlan] = []
    load = plan.load_kg
    reps = clamp_int(first_set_reps(exercise, plan), exercise.rep_lo, exercise.rep_hi)

    for i in range(plan.sets):
        entry = log[i] if i < len(log) and log[i] is not None else SetLogEntry()
        assert entry is not None  # el guard de arriba ya lo garantiza

        if i == 0:
            why = plan.why
        else:
            prev_entry = log[i - 1] if i - 1 < len(log) else None
            prev_plan = out[i - 1] if i - 1 < len(out) else None

            if prev_entry is not None and prev_entry.done:
                prev_reps = parse_leading_int(prev_entry.reps)
                prev_weight = prev_entry.weight_kg
                if prev_weight is not None:
                    base = prev_weight
                elif prev_plan is not None:
                    base = prev_plan.target_weight_kg
                else:
                    base = load

                if prev_reps < exercise.rep_lo:
                    load = round_to(
                        max(exercise.load_increment_kg, base - exercise.load_increment_kg),
                        exercise.load_increment_kg,
                    )
                    reps = exercise.rep_lo
                    why = Reasons.back_off(exercise.rep_lo)
                elif prev_reps > exercise.rep_hi:
                    load = round_to(
                        base + exercise.load_increment_kg,
                        exercise.load_increment_kg,
                    )
                    reps = exercise.rep_hi
                    why = Reasons.LOAD_UP
                else:
                    load = base
                    reps = clamp_int(prev_reps - 1, exercise.rep_lo, exercise.rep_hi)
                    why = Reasons.FATIGUE_DROP
            else:
                reps = clamp_int(reps - 1, exercise.rep_lo, exercise.rep_hi)
                why = Reasons.EXPECTED_DROP

        # El último set, cuando lo añadió el feedback, explica por qué existe.
        if i == plan.sets - 1 and plan.set_note == SET_NOTE_ADD:
            why = Reasons.added_set(plan.add_reason)

        out.append(
            SetPlan(
                index=i,
                target_weight_kg=load,
                target_reps=reps,
                why=why,
                logged_weight_kg=entry.weight_kg,
                logged_reps=entry.reps,
                logged_rpe=entry.rpe,
                logged_sub_sets=entry.sub_sets,
                done=bool(entry.done),
            )
        )

    return out


def first_set_reps(exercise: Exercise, plan: ExercisePlan) -> int:
    """Reps objetivo del primer set.

    Si la carga sube se espera una rep menos que la semana pasada; si baja, una
    más; si se mantiene, las mismas.
    """
    if plan.delta_kg > 0:
        return exercise.last.reps - 1
    if plan.delta_kg < 0:
        return exercise.last.reps + 1
    return exercise.last.reps
