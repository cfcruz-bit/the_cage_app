"""Modelos de entrada y salida de la API.

Separados de `app/models/` (las tablas) y de `app/domain/schemas.py` (el motor)
a proposito. Si la API devolviera las tablas directamente, cualquier columna
nueva se publicaria sola —incluido `password_hash`— y cada cambio de esquema
seria un cambio de contrato.

Todo sale en **camelCase**, que es lo que consume el cliente de TypeScript sin
traduccion. Se acepta cualquiera de las dos formas en la entrada.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.security import MIN_PASSWORD_LENGTH
from app.domain.schemas import Aggressiveness, Exercise, Feedback, MuscleGroup
from app.models.training import TrainingGoal


def _camel(snake: str) -> str:
    head, *rest = snake.split("_")
    return head + "".join(w.capitalize() for w in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ── Autenticacion ────────────────────────────────────────────────────────────


class RegisterRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=256)
    display_name: str = Field(min_length=1, max_length=120)
    role: str = Field(pattern="^(coach|athlete)$")

    @field_validator("email")
    @classmethod
    def _minusculas(cls, v: str) -> str:
        """La base tiene un CHECK que lo exige; normalizar aqui evita un 500."""
        return v.lower()


class LoginRequest(ApiModel):
    email: EmailStr
    password: str = Field(max_length=256)

    @field_validator("email")
    @classmethod
    def _minusculas(cls, v: str) -> str:
        return v.lower()


class RefreshRequest(ApiModel):
    refresh_token: str


class TokenPair(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime


class UserOut(ApiModel):
    id: uuid.UUID
    email: str
    display_name: str
    role: str
    #: True mientras arrastre la contrasena provisional del admin.
    must_change_password: bool = False
    #: Ultimo dia pagado. None para coach y admin, que no caducan.
    access_ends_on: date | None = None
    #: Dias que quedan, incluido hoy. None si el rol no caduca.
    days_left: int | None = None
    #: True cuando toca enseñarle el aviso de renovacion en la app.
    renewal_warning: bool = False


class ChangePasswordRequest(ApiModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=256)


# ── Cartera del coach ────────────────────────────────────────────────────────


class LinkAthleteRequest(ApiModel):
    """El coach da de alta a un atleta que ya tiene cuenta, por su email."""

    email: EmailStr

    @field_validator("email")
    @classmethod
    def _minusculas(cls, v: str) -> str:
        return v.lower()


# ── Catalogo ─────────────────────────────────────────────────────────────────


class ExerciseCatalogIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    muscle: MuscleGroup
    equipment: str = Field(min_length=1, max_length=60)
    rep_lo: int = Field(ge=1, le=100)
    rep_hi: int = Field(ge=1, le=100)
    target_rir: int = Field(ge=0, le=10)
    load_increment_kg: float = Field(gt=0, le=50)


class ExerciseCatalogOut(ExerciseCatalogIn):
    id: uuid.UUID


# ── Mesociclos ───────────────────────────────────────────────────────────────


class MesocycleExerciseIn(ApiModel):
    catalog_id: uuid.UUID
    rep_lo: int = Field(ge=1, le=100)
    rep_hi: int = Field(ge=1, le=100)
    target_rir: int = Field(ge=0, le=10)
    load_increment_kg: float = Field(gt=0, le=50)
    starting_load_kg: float = Field(gt=0, le=1000)
    starting_reps: int = Field(ge=1, le=100)
    starting_sets: int = Field(ge=1, le=20)


class MesocycleIn(ApiModel):
    athlete_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    total_weeks: int = Field(default=6, ge=2, le=24)
    aggressiveness: Aggressiveness = Aggressiveness.MEDIUM
    goal: TrainingGoal = TrainingGoal.HYPERTROPHY
    exercises: list[MesocycleExerciseIn] = Field(min_length=1, max_length=40)


class PrescriptionIn(ApiModel):
    """Lo que el coach fija a mano. null = lo decide el motor."""

    #: None = para todo el bloque. N = solo para la semana N.
    week_number: int | None = Field(default=None, ge=1, le=24)
    sets: int | None = Field(default=None, ge=1, le=20)
    load_kg: float | None = Field(default=None, gt=0, le=1000)
    rep_lo: int | None = Field(default=None, ge=1, le=100)
    rep_hi: int | None = Field(default=None, ge=1, le=100)
    target_rir: int | None = Field(default=None, ge=0, le=10)
    rest_seconds: int = Field(default=150, gt=0, le=900)


class PrescriptionOut(PrescriptionIn):
    mesocycle_exercise_id: uuid.UUID


class MesocycleExerciseOut(ApiModel):
    id: uuid.UUID
    position: int
    name: str
    muscle: str
    equipment: str
    rep_lo: int
    rep_hi: int
    target_rir: int
    load_increment_kg: float
    #: Punto de partida de la semana 1. Viaja al cliente porque el movil usa el
    #: MISMO motor para dibujar la proyeccion del mesociclo sin pedir nada mas.
    starting_load_kg: float
    starting_reps: int
    starting_sets: int
    prescription: PrescriptionOut | None


class MesocycleSummaryOut(ApiModel):
    """Una fila de la lista de mesociclos. Sin los ejercicios."""

    id: uuid.UUID
    athlete_id: uuid.UUID
    athlete_name: str
    name: str
    total_weeks: int
    current_week_index: int
    aggressiveness: str
    goal: str
    status: str
    exercise_count: int


class MesocycleOut(ApiModel):
    id: uuid.UUID
    athlete_id: uuid.UUID
    coach_id: uuid.UUID
    name: str
    total_weeks: int
    current_week_index: int
    aggressiveness: str
    goal: str
    status: str
    exercises: list[MesocycleExerciseOut]


# ── Sesiones ─────────────────────────────────────────────────────────────────


class SessionCreate(ApiModel):
    week_number: int = Field(ge=1, le=24)
    day_label: str = Field(min_length=1, max_length=60)


class PlannedSetOut(ApiModel):
    index: int
    target_weight_kg: float
    target_reps: int
    why: str
    logged_weight_kg: float | None
    logged_reps: str | None
    logged_rpe: str | None
    done: bool


class SessionExerciseOut(ApiModel):
    id: uuid.UUID
    position: int
    name: str
    muscle: str
    planned_load_kg: float
    planned_sets: int
    rest_seconds: int
    policy_version: str
    why: str
    sets: list[PlannedSetOut]

    #: El ejercicio tal como lo entiende el motor, incluido lo que hizo la vez
    #: anterior.
    #:
    #: Viaja para que el movil pueda enseñarle al atleta el EFECTO de su
    #: feedback antes de enviarlo: "esto subiria la carga a 65 kg". Ese calculo
    #: tiene que ser instantaneo y funcionar sin cobertura, asi que lo hace el
    #: cliente con el mismo motor. Lo que se persiste sigue saliendo de aqui.
    exercise: Exercise


class SessionOut(ApiModel):
    id: uuid.UUID
    mesocycle_id: uuid.UUID
    week_number: int
    day_label: str
    is_deload: bool
    started_at: datetime | None
    completed_at: datetime | None
    exercises: list[SessionExerciseOut]


class SetLogIn(ApiModel):
    """Un set registrado por el atleta.

    `clientId` lo genera el telefono y es la clave de idempotencia: reenviar el
    mismo set actualiza la fila en vez de crear otra.
    """

    client_id: str = Field(min_length=8, max_length=36)
    session_exercise_id: uuid.UUID
    index: int = Field(ge=0, le=50)
    weight_kg: float | None = Field(default=None, ge=0, le=1000)
    reps: str | None = Field(default=None, max_length=16)
    rpe: str | None = Field(default=None, max_length=16)
    sub_sets: str | None = Field(default=None, max_length=32)
    done: bool = False
    logged_at: datetime | None = None


class SetLogBatch(ApiModel):
    """Lo que vacia la cola de sincronizacion del telefono."""

    sets: list[SetLogIn] = Field(min_length=1, max_length=200)


class SyncResult(ApiModel):
    accepted: int
    #: clientId que ya existian y se actualizaron en vez de duplicarse.
    updated: list[str]


class FeedbackIn(ApiModel):
    session_exercise_id: uuid.UUID
    feedback: Feedback


# ── Panel del coach ──────────────────────────────────────────────────────────


class AlertOut(ApiModel):
    kind: str
    severity: str
    #: Ejercicio al que se refiere. Vacio si es del mesociclo entero.
    subject: str
    text: str
    suggestion: str


class SessionSummaryOut(ApiModel):
    id: uuid.UUID
    week_number: int
    day_label: str
    is_deload: bool
    completed_at: datetime | None
    #: "Completa" | "Parcial" | "Perdida". Lo que pintaba el prototipo.
    status: str
    sets_done: int
    #: Suma de peso x reps de los sets marcados, en kg.
    tonnage_kg: float


class AthleteSummaryOut(ApiModel):
    """La tarjeta del atleta en el panel del coach.

    Reemplaza a `CLIENTS` de `apps/mobile/src/data/clients.ts`, que eran datos
    del prototipo escritos a mano.
    """

    athlete: UserOut
    mesocycle_id: uuid.UUID | None
    mesocycle_name: str | None
    current_week: int | None
    total_weeks: int | None
    #: Progreso del bloque, 0-100.
    progress: int
    #: Sesiones completadas / generadas, 0-100. None si no hay ninguna.
    adherence: int | None
    alerts: list[AlertOut]
    sessions: list[SessionSummaryOut]


class AthleteCardOut(ApiModel):
    """Una fila de la lista de clientes.

    Deliberadamente mas ligera que AthleteSummaryOut: la lista no necesita el
    historico de sesiones, y pedirlo para diez atletas serian diez consultas y
    un payload que el telefono descarta. El detalle se pide al abrir la ficha.
    """

    athlete: UserOut
    mesocycle_id: uuid.UUID | None
    mesocycle_name: str | None
    current_week: int | None
    total_weeks: int | None
    progress: int
    adherence: int | None
    alert_count: int
    #: La alerta mas urgente, para pintarla sin abrir la ficha.
    top_alert: AlertOut | None


class CoachOverviewOut(ApiModel):
    """Las cifras de cabecera del panel."""

    athletes: int
    sessions_last_7_days: int
    open_alerts: int


# ── Administracion ───────────────────────────────────────────────────────────


class CreateCoachRequest(ApiModel):
    """Alta de un entrenador. Sin fechas: su acceso no caduca."""

    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("email")
    @classmethod
    def _minusculas(cls, v: str) -> str:
        return v.lower()


class CreateAthleteRequest(ApiModel):
    """Alta de un atleta, con su primer periodo pagado y su entrenador."""

    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    coach_id: uuid.UUID
    months: int = Field(default=1, ge=1, le=24)
    note: str = Field(default="", max_length=280)

    @field_validator("email")
    @classmethod
    def _minusculas(cls, v: str) -> str:
        return v.lower()


class RenewRequest(ApiModel):
    months: int = Field(default=1, ge=1, le=24)
    note: str = Field(default="", max_length=280)


class CreatedUserOut(ApiModel):
    """Respuesta del alta. La contrasena provisional aparece UNA sola vez.

    No se guarda en claro en ningun sitio: si se pierde, se regenera. Es lo que
    permite que el admin deje de conocerla en cuanto el usuario entra y la
    cambia.
    """

    user: UserOut
    temporary_password: str


class MembershipOut(ApiModel):
    id: uuid.UUID
    starts_on: date
    ends_on: date
    note: str


class AdminUserRow(ApiModel):
    """Una fila de la tabla del panel."""

    id: uuid.UUID
    email: str
    display_name: str
    role: str
    is_active: bool
    must_change_password: bool
    coach_name: str | None
    access_ends_on: date | None
    days_left: int | None
    #: "activo" | "por vencer" | "vencido" | "sin acceso" | "no caduca"
    status: str


# ── La rejilla del plan ──────────────────────────────────────────────────────


class PlanCellOut(ApiModel):
    """Lo que hara un ejercicio en una semana concreta.

    Los `*_overridden` son lo que hace util a esta pantalla: sin ellos, el
    coach no puede distinguir un numero que puso el de uno que calculo el
    motor, y no sabria que esta a punto de pisar.
    """

    week_number: int
    is_deload: bool
    sets: int
    load_kg: float
    rep_lo: int
    rep_hi: int
    target_rir: int
    rest_seconds: int

    sets_overridden: bool
    load_overridden: bool
    reps_overridden: bool
    rir_overridden: bool

    @property
    def any_overridden(self) -> bool:
        return (
            self.sets_overridden
            or self.load_overridden
            or self.reps_overridden
            or self.rir_overridden
        )


class PlanRowOut(ApiModel):
    """Un ejercicio, con sus N semanas."""

    mesocycle_exercise_id: uuid.UUID
    name: str
    muscle: str
    equipment: str
    weeks: list[PlanCellOut]


class PlanGridOut(ApiModel):
    """El mesociclo entero como tabla: ejercicios x semanas.

    Se calcula en el SERVIDOR y no en el movil aunque el motor este en los dos
    sitios, porque proyectar necesita el historico real de cada semana, y eso
    solo lo tiene la base.
    """

    mesocycle_id: uuid.UUID
    name: str
    goal: str
    total_weeks: int
    current_week_index: int
    rows: list[PlanRowOut]
