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

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

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


class WeekLoadIn(ApiModel):
    """Una fila del paso 4 opcional: la carga de UNA semana de UN ejercicio.

    Se guarda como una `Prescription` de esa semana. Es la misma regla de
    `PrescriptionIn`: kilos o porcentaje, nunca los dos.
    """

    week_number: int = Field(ge=1, le=24)
    load_kg: float | None = Field(default=None, gt=0, le=1000)
    load_percent: float | None = Field(default=None, ge=30, le=110)
    sets: int | None = Field(default=None, ge=1, le=20)
    rep_lo: int | None = Field(default=None, ge=1, le=100)
    rep_hi: int | None = Field(default=None, ge=1, le=100)
    target_rir: int | None = Field(default=None, ge=0, le=10)

    @model_validator(mode="after")
    def _carga_o_porcentaje(self) -> WeekLoadIn:
        if self.load_kg is not None and self.load_percent is not None:
            raise ValueError("Fija la carga en kilos o en porcentaje del 1RM, no los dos")
        return self


class MesocycleDayIn(ApiModel):
    """El nombre opcional de un dia ("Empuje"). Sin nombre no se manda nada."""

    day_number: int = Field(ge=1, le=7)
    name: str = Field(min_length=1, max_length=40)


class MesocycleDayOut(ApiModel):
    day_number: int
    name: str


class MesocycleExerciseIn(ApiModel):
    catalog_id: uuid.UUID
    #: Dia de la semana al que va. El tope contra `daysPerWeek` lo valida el
    #: endpoint: aqui solo se sabe el maximo absoluto.
    day_number: int = Field(default=1, ge=1, le=7)
    rep_lo: int = Field(ge=1, le=100)
    rep_hi: int = Field(ge=1, le=100)
    target_rir: int = Field(ge=0, le=10)
    load_increment_kg: float = Field(gt=0, le=50)
    #: Punto de partida de la semana 1. Sin el (None) no hay ningun peso del
    #: que arrancar hasta que se registre uno real; ver el docstring de
    #: `app.models.training.MesocycleExercise.starting_load_kg`.
    starting_load_kg: float | None = Field(default=None, gt=0, le=1000)
    starting_reps: int = Field(ge=1, le=100)
    starting_sets: int = Field(ge=1, le=20)
    #: Carga semana a semana del paso 4 opcional. Cada fila se guarda como una
    #: `Prescription` de esa semana. Para un BASICO, el servidor exige que
    #: aqui haya carga (kg o %) en TODAS las semanas del bloque.
    weeks: list[WeekLoadIn] = Field(default_factory=list, max_length=24)


class MesocycleIn(ApiModel):
    athlete_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    total_weeks: int = Field(default=6, ge=2, le=24)
    aggressiveness: Aggressiveness = Aggressiveness.MEDIUM
    goal: TrainingGoal = TrainingGoal.HYPERTROPHY
    days_per_week: int = Field(default=1, ge=1, le=7)
    days: list[MesocycleDayIn] = Field(default_factory=list, max_length=7)
    exercises: list[MesocycleExerciseIn] = Field(min_length=1, max_length=40)


class DayExerciseIn(ApiModel):
    """Donde queda un ejercicio del mesociclo tras editar el reparto."""

    exercise_id: uuid.UUID
    day_number: int = Field(ge=1, le=7)
    position: int = Field(ge=0, le=100)


class MesocycleDaysIn(ApiModel):
    """Cuerpo de `PUT /mesocycles/{id}/days`.

    `days` son TODOS los nombres que debe haber al terminar (un dia que no
    aparezca se queda sin nombre). `exercises` solo lista los que se mueven:
    los que no aparezcan conservan su dia y su posicion.
    """

    days_per_week: int = Field(ge=1, le=7)
    days: list[MesocycleDayIn] = Field(default_factory=list, max_length=7)
    exercises: list[DayExerciseIn] = Field(default_factory=list, max_length=40)


class PrescriptionIn(ApiModel):
    """Lo que el coach fija a mano. null = lo decide el motor."""

    #: None = para todo el bloque. N = solo para la semana N.
    week_number: int | None = Field(default=None, ge=1, le=24)
    sets: int | None = Field(default=None, ge=1, le=20)
    load_kg: float | None = Field(default=None, gt=0, le=1000)
    #: Porcentaje del 1RM vigente. Mutuamente excluyente con `load_kg`: kilos
    #: fijos y porcentaje son dos formas de decir lo mismo, nunca las dos.
    load_percent: float | None = Field(default=None, ge=30, le=110)
    rep_lo: int | None = Field(default=None, ge=1, le=100)
    rep_hi: int | None = Field(default=None, ge=1, le=100)
    target_rir: int | None = Field(default=None, ge=0, le=10)
    rest_seconds: int = Field(default=150, gt=0, le=900)

    @model_validator(mode="after")
    def _carga_o_porcentaje(self) -> PrescriptionIn:
        if self.load_kg is not None and self.load_percent is not None:
            raise ValueError("Fija la carga en kilos o en porcentaje del 1RM, no los dos")
        return self


class PrescriptionOut(PrescriptionIn):
    mesocycle_exercise_id: uuid.UUID
    #: La marca vigente usada para resolver el porcentaje, o null si no hay
    #: (o si esta fila no usa porcentaje).
    one_rm_kg: float | None = None
    #: True cuando hay `load_percent` pero el atleta no tiene marca de ese
    #: ejercicio: la celda no se puede resolver a kilos todavia.
    needs_one_rm: bool = False


class MesocycleExerciseOut(ApiModel):
    id: uuid.UUID
    day_number: int
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
    #: null cuando todavia no hay ningun peso: el accesorio se dejo libre.
    starting_load_kg: float | None
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
    days_per_week: int
    days: list[MesocycleDayOut]


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
    days_per_week: int
    days: list[MesocycleDayOut]
    exercises: list[MesocycleExerciseOut]


# ── Sesiones ─────────────────────────────────────────────────────────────────


class SessionCreate(ApiModel):
    week_number: int = Field(ge=1, le=24)
    day_number: int = Field(ge=1, le=7)
    #: Opcional: si no viene, se rellena con el nombre del dia o "Dia N". Si
    #: viene, gana (compatibilidad con clientes que lo mandaban a mano).
    day_label: str | None = Field(default=None, min_length=1, max_length=60)


class PlannedSetOut(ApiModel):
    index: int
    #: null cuando el ejercicio no tiene ningun peso todavia: el set sale en
    #: blanco y el atleta escribe el suyo, sin marcador inventado.
    target_weight_kg: float | None
    target_reps: int | None
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
    #: null en la primera sesion de un ejercicio sin arranque: nadie ha dado
    #: todavia un peso real. El atleta lo escribe el mismo en la sesion.
    planned_load_kg: float | None
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
    #:
    #: null junto con `plannedLoadKg` null: sin ningun peso previo el motor no
    #: tiene de donde partir, asi que tampoco hay preview local que calcular.
    exercise: Exercise | None


class SessionOut(ApiModel):
    id: uuid.UUID
    mesocycle_id: uuid.UUID
    week_number: int
    day_number: int
    day_label: str
    is_deload: bool
    started_at: datetime | None
    completed_at: datetime | None
    exercises: list[SessionExerciseOut]


class NextUpOut(ApiModel):
    """Lo que le toca entrenar al atleta. Lo calcula el servidor, nunca el cliente."""

    week_number: int
    day_number: int
    #: null si el coach no le puso nombre al dia: la app pinta "Dia N".
    day_name: str | None


class CurrentSessionOut(ApiModel):
    """La sesion abierta y, si no hay ninguna, cual toca abrir."""

    session: SessionOut | None
    next: NextUpOut | None
    #: True si el atleta tiene mesociclo y ya hizo todos sus dias. Distingue
    #: "bloque terminado" de "sin mesociclo", que ambos llegan con next null.
    finished: bool = False


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
    #: null cuando la semana esta pautada por % y el atleta todavia no tiene
    #: marca de ese ejercicio: no hay peso que mostrar, solo una intencion.
    load_kg: float | None
    #: El % que fijo el coach para esta semana, si lo hizo.
    load_percent: float | None
    #: La marca usada para resolverlo, o null si no aplica.
    one_rm_kg: float | None
    #: True si hace falta una marca de 1RM que todavia no existe.
    needs_one_rm: bool
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
    day_number: int
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
    days_per_week: int
    days: list[MesocycleDayOut]
    #: Ordenadas por (dia, posicion): la app agrupa bajo un encabezado por dia.
    rows: list[PlanRowOut]


# ── Marcas de fuerza (1RM) ───────────────────────────────────────────────────


class OneRepMaxIn(ApiModel):
    """Una marca que el coach registra.

    `achievedOn` es el dia del TEST, no el de hoy: se apunta el lunes lo que
    paso el sabado. Por eso no tiene valor por defecto y hay que mandarlo.
    """

    exercise_id: uuid.UUID
    #: 600 kg es el techo del CHECK de la base. Por debajo de 20 casi siempre
    #: es un cero que falta, pero se deja pasar: hay atletas que empiezan con
    #: la barra vacia y no es asunto de la API decidirlo.
    value_kg: float = Field(gt=0, le=600)
    achieved_on: date
    source: str = Field(pattern="^(test|competicion|estimada)$")
    note: str | None = Field(default=None, max_length=200)


class OneRepMaxOut(ApiModel):
    id: uuid.UUID
    exercise_id: uuid.UUID
    #: Para no obligar al movil a cruzar con el catalogo solo para pintarlo.
    exercise_name: str
    muscle: str
    value_kg: float
    achieved_on: date
    source: str
    note: str | None = None
    #: True si es la vigente de ese ejercicio. La calcula el servidor: es la
    #: mas reciente por fecha, y el cliente no deberia tener que deducirlo.
    current: bool = False
