"""Tipos del dominio.

Port de `packages/engine/src/types.ts`. Los alias camelCase no son decoración:
permiten comparar `model_dump(by_alias=True)` directamente contra el JSON que
generó TypeScript, sin capa de traducción por medio. Ese es todo el truco del
test de contrato.

INVARIANTE: toda carga está en KILOGRAMOS. Las libras son una preferencia de
presentación y se convierten en el cliente, nunca aquí ni en la base.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


def _camel(snake: str) -> str:
    head, *rest = snake.split("_")
    return head + "".join(w.capitalize() for w in rest)


class DomainModel(BaseModel):
    """Base con alias camelCase y validación por nombre o por alias."""

    model_config = ConfigDict(
        alias_generator=_camel,
        populate_by_name=True,
        frozen=True,
    )


class MuscleGroup(StrEnum):
    """Como se agrupa el catalogo.

    `BASICOS` no es un musculo y esta aqui a proposito: son los tres
    movimientos de competicion y sus variantes, que el coach programa como
    bloque propio y no repartidos entre pecho, cuadriceps y espalda. Agruparlos
    por musculo era tecnicamente correcto y practicamente inutil: nadie monta
    un dia de "pecho" que empiece por una sentadilla lowbar.

    Consecuencia a tener presente: los objetivos de volumen semanal se cuentan
    por musculo, y lo que se haga en BASICOS no suma a ninguno de ellos. Para
    los basicos el volumen lo fija el coach a mano, que es como se programa
    fuerza de todas formas.
    """

    BASICOS = "BASICOS"
    CHEST = "CHEST"
    BACK = "BACK"
    SHOULDERS = "SHOULDERS"
    BICEPS = "BICEPS"
    TRICEPS = "TRICEPS"
    QUADS = "QUADS"
    HAMSTRINGS = "HAMSTRINGS"
    GLUTES = "GLUTES"
    CALVES = "CALVES"
    ABS = "ABS"


class Aggressiveness(StrEnum):
    """Cuánto multiplica los saltos de carga. La elige el atleta."""

    LOW = "Baja"
    MEDIUM = "Media"
    HIGH = "Alta"


# ── Feedback subjetivo post-ejercicio ────────────────────────────────────────
# Los valores son los literales que ve el atleta en pantalla. Se persisten tal
# cual para que el histórico no dependa de una tabla de traducción.


class JointPain(StrEnum):
    NONE = "Ninguno"
    LITTLE = "Poco"
    MODERATE = "Moderado"
    SEVERE = "Mucho"


class Soreness(StrEnum):
    NEVER = "Nunca me dolió"
    GONE_DAYS_AGO = "Se fue hace días"
    GONE_JUST_IN_TIME = "Se fue justo a tiempo"
    STILL_SORE = "Aún me duele"


class Pump(StrEnum):
    LOW = "Bajo"
    MODERATE = "Moderado"
    AMAZING = "Increíble"


class WorkloadFeel(StrEnum):
    NOT_ENOUGH = "Insuficiente"
    RIGHT = "Justo"
    AT_LIMIT = "Al límite"
    TOO_MUCH = "Demasiado"


class SetType(StrEnum):
    REGULAR = "regular"
    MYOREP = "myorep"
    MYOREP_MATCH = "myorep_match"


class Feedback(DomainModel):
    joint: JointPain
    soreness: Soreness
    pump: Pump
    volume: WorkloadFeel


# ── Ejercicio y rendimiento previo ───────────────────────────────────────────


class LastPerformance(DomainModel):
    """Lo que el atleta hizo la última vez que entrenó este ejercicio."""

    weight_kg: float
    reps: int
    rir: int
    sets: int
    feedback: Feedback


class Exercise(DomainModel):
    """Prescripción de un ejercicio dentro de un mesociclo."""

    id: str
    name: str
    muscle: MuscleGroup
    equipment: str
    rep_lo: int
    rep_hi: int
    target_rir: int
    #: Salto mínimo de carga disponible, en kg (mancuernas 2.5, cable 1.25…).
    load_increment_kg: float
    last: LastPerformance


# ── Salida del motor ─────────────────────────────────────────────────────────


class ExercisePlan(DomainModel):
    """Plan semanal del ejercicio: qué carga y cuántos hard sets tocan hoy."""

    load_kg: float
    sets: int
    #: load_kg − last.weight_kg. Positivo sube, negativo baja.
    delta_kg: float
    #: '+1 set' | '−1 set' (U+2212) | None.
    set_note: str | None
    #: Motivo del set añadido, vacío si no se añadió ninguno.
    add_reason: str
    #: Explicación en lenguaje natural. Viaja hasta la pantalla del atleta.
    why: str
    e1rm: float
    e1rm_next: float
    policy_version: str


class SetLogEntry(DomainModel):
    """Lo que el atleta registró en un set concreto."""

    weight_kg: float | None = None
    #: Reps tal como las tecleó. String por fidelidad con el input del cliente.
    reps: str | None = None
    rpe: str | None = None
    sub_sets: str | None = None
    done: bool = False


class SetPlan(DomainModel):
    """Objetivo de un set individual, recalculado con lo registrado hoy."""

    index: int
    target_weight_kg: float
    target_reps: int
    why: str
    #: Eco de lo registrado, para que el cliente pinte sin cruzar arrays.
    logged_weight_kg: float | None
    logged_reps: str | None
    logged_rpe: str | None
    logged_sub_sets: str | None
    done: bool


class ProjectedWeek(DomainModel):
    """Una semana de la proyección del mesociclo."""

    index: int
    #: Número de semana 1-based, o None si es el deload.
    week_number: int | None
    is_deload: bool
    sets: int
    rep_lo: int
    rep_hi: int
    load_kg: float
    target_rir: int
    #: Carga como fracción del e1RM de referencia (0–1).
    intensity_ratio: float


class ProjectionOptions(BaseModel):
    """Opciones de `project_mesocycle`."""

    total_weeks: int = Field(default=7, ge=2, le=24)
    current_week_index: int = Field(default=4, ge=0)
