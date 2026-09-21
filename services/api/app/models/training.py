"""Catalogo de ejercicios, mesociclos y prescripciones del coach.

Jerarquia:

    exercise_catalog      biblioteca: "Press banca con barra"
      |
    mesocycles            "Push/Pull/Legs, 6 semanas, de Jorge"
      |
    mesocycle_exercises   ese press dentro de ese meso, con su rango y su RIR
      |
    prescriptions         lo que el coach fijo a mano encima (0 o 1 por fila)

La separacion entre `mesocycle_exercises` y `prescriptions` es deliberada. La
primera es la configuracion del ejercicio; la segunda son los OVERRIDES del
coach, y cada campo en NULL significa "aqui manda el motor". Si estuvieran en
la misma tabla no se podria distinguir "el coach puso 3 sets" de "el motor
calculo 3 sets", y esa distincion es justo lo que la pantalla del coach
muestra.
"""

from __future__ import annotations

import uuid
from datetime import date
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid
from app.domain.schemas import Aggressiveness, MuscleGroup
from app.models._helpers import enum_check

#: Descanso por defecto entre series. Coincide con DEFAULT_REST_SECONDS del
#: cliente (`apps/mobile/src/lib/prescription.ts`). Si cambia uno, cambia el
#: otro.
DEFAULT_REST_SECONDS = 150


class MesocycleStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class TrainingGoal(StrEnum):
    """Objetivo del bloque.

    No cambia el comportamiento del motor: decide los valores POR DEFECTO con
    los que entra cada ejercicio (rango de reps, RIR y series de arranque) y se
    guarda para que coach y atleta sepan que se estaba buscando. Lo que el
    coach ajuste encima manda.
    """

    STRENGTH = "fuerza"
    HYPERTROPHY = "hipertrofia"
    HYBRID = "hibrido"


class OneRepMaxSource(StrEnum):
    """De donde salio la marca. No todas valen lo mismo."""

    #: Test de fuerza en el gimnasio.
    TEST = "test"
    #: Competicion oficial. El dato mas fiable que hay.
    COMPETICION = "competicion"
    #: Calculada con Epley desde una serie submaxima registrada.
    ESTIMADA = "estimada"


class ExerciseCatalog(Base, TimestampMixin):
    """Biblioteca de ejercicios.

    `created_by_id` NULL = ejercicio del sistema, visible para todos. Con
    valor = ejercicio propio de ese coach.
    """

    __tablename__ = "exercise_catalog"
    __table_args__ = (
        enum_check("muscle", MuscleGroup, "musculo_valido"),
        CheckConstraint("rep_lo >= 1 AND rep_hi >= rep_lo", name="rango_reps"),
        CheckConstraint("target_rir >= 0 AND target_rir <= 10", name="rir_valido"),
        CheckConstraint("load_increment_kg > 0", name="incremento_positivo"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    muscle: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    equipment: Mapped[str] = mapped_column(String(60), nullable=False)

    rep_lo: Mapped[int] = mapped_column(Integer, nullable=False)
    rep_hi: Mapped[int] = mapped_column(Integer, nullable=False)
    target_rir: Mapped[int] = mapped_column(Integer, nullable=False)

    #: Salto minimo montable con el material del gimnasio (mancuernas 2.5,
    #: placas de cable 1.25...). En KG, como todo en esta base.
    load_increment_kg: Mapped[float] = mapped_column(Float, nullable=False)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class OneRepMax(Base, TimestampMixin):
    """Una marca del atleta en un ejercicio, con su fecha.

    Existe porque los basicos se programan por PORCENTAJE. Sin saber el maximo
    del atleta, un "75%" no es un peso: es una intencion.

    **Es un historial, no un campo.** Cada test o competicion anade una fila;
    ninguna sobrescribe a la anterior. Tres razones:

    - La marca vigente es la mas reciente, y eso se calcula, no se guarda.
    - Un mesociclo programado en marzo se pauto con la marca de marzo. Si la
      marca fuera un campo mutable, subir el maximo reescribiria en silencio
      los pesos de todos los bloques pasados y el historial mentiria.
    - La progresion de marcas en el tiempo es, para un powerlifter, el dato que
      mas le importa de todos.

    `source` distingue de donde salio, porque no valen lo mismo: un 180 en
    competicion es un hecho, un 180 estimado con Epley desde una serie de 5 es
    una cuenta.
    """

    __tablename__ = "one_rep_maxes"
    __table_args__ = (
        enum_check("source", OneRepMaxSource, "origen_valido"),
        CheckConstraint("value_kg > 0 AND value_kg <= 600", name="marca_razonable"),
        # Dos marcas del mismo ejercicio el mismo dia son un dedazo, no dos
        # tests: nadie hace dos maximos del mismo movimiento en una sesion.
        UniqueConstraint("athlete_id", "exercise_id", "achieved_on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)

    athlete_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    exercise_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("exercise_catalog.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    #: En KG, como todo lo que se persiste. Libras es preferencia de pantalla.
    value_kg: Mapped[float] = mapped_column(Float, nullable=False)

    #: El dia del test, NO el dia en que se escribio en la app. Un coach
    #: apuntando el lunes la marca del sabado tiene que poder poner el sabado.
    achieved_on: Mapped[date] = mapped_column(Date, nullable=False)

    source: Mapped[str] = mapped_column(String(12), nullable=False)

    note: Mapped[str | None] = mapped_column(String(200), nullable=True)

    #: Que coach la registro. Para el historial de "quien apunto esto".
    set_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Mesocycle(Base, TimestampMixin):
    """Un bloque de entrenamiento de un atleta.

    Solo lo crea un coach: es una regla de producto explicita del cliente. La
    base no la impone (coach_id podria apuntar a cualquiera), la imponen los
    endpoints comprobando `coach_athletes`.
    """

    __tablename__ = "mesocycles"
    __table_args__ = (
        enum_check("status", MesocycleStatus, "estado_valido"),
        enum_check("goal", TrainingGoal, "objetivo_valido"),
        enum_check("aggressiveness", Aggressiveness, "agresividad_valida"),
        CheckConstraint("total_weeks >= 2 AND total_weeks <= 24", name="semanas_validas"),
        CheckConstraint(
            "current_week_index >= 0 AND current_week_index < total_weeks",
            name="semana_actual_dentro_del_bloque",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    athlete_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    coach_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    total_weeks: Mapped[int] = mapped_column(Integer, nullable=False, default=6)
    current_week_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    #: Preferencia del atleta, no del coach. Multiplica los saltos de carga.
    aggressiveness: Mapped[str] = mapped_column(
        String(8), nullable=False, default=Aggressiveness.MEDIUM.value
    )
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, default=MesocycleStatus.DRAFT.value
    )
    goal: Mapped[str] = mapped_column(
        String(12), nullable=False, default=TrainingGoal.HYPERTROPHY.value
    )
    started_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    exercises: Mapped[list[MesocycleExercise]] = relationship(
        back_populates="mesocycle",
        cascade="all, delete-orphan",
        order_by="MesocycleExercise.position",
    )


class MesocycleExercise(Base, TimestampMixin):
    """Un ejercicio dentro de un mesociclo, con su configuracion."""

    __tablename__ = "mesocycle_exercises"
    __table_args__ = (
        UniqueConstraint("mesocycle_id", "position"),
        CheckConstraint("rep_lo >= 1 AND rep_hi >= rep_lo", name="rango_reps"),
        CheckConstraint("target_rir >= 0 AND target_rir <= 10", name="rir_valido"),
        CheckConstraint("load_increment_kg > 0", name="incremento_positivo"),
        CheckConstraint(
            "starting_load_kg IS NULL OR starting_load_kg > 0", name="carga_inicial_positiva"
        ),
        CheckConstraint("starting_reps >= 1 AND starting_sets >= 1", name="arranque_positivo"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    mesocycle_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("mesocycles.id", ondelete="CASCADE"), nullable=False
    )
    catalog_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exercise_catalog.id", ondelete="RESTRICT"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    rep_lo: Mapped[int] = mapped_column(Integer, nullable=False)
    rep_hi: Mapped[int] = mapped_column(Integer, nullable=False)
    target_rir: Mapped[int] = mapped_column(Integer, nullable=False)
    load_increment_kg: Mapped[float] = mapped_column(Float, nullable=False)

    #: Punto de partida de la semana 1. El motor necesita SIEMPRE un "la vez
    #: anterior" para calcular; cuando todavia no hay historico, es esto. Lo
    #: rellena el coach en el test de cargas iniciales.
    #:
    #: NULL es valido y significa que todavia no hay ningun peso: pasa con los
    #: accesorios, que el producto deja sin arranque a proposito. Mientras sea
    #: NULL y no haya ninguna sesion completada con peso, el motor no corre
    #: para este ejercicio (`app/services/planning.py::last_performance`): no
    #: hay ningun peso inventado que ofrecerle.
    starting_load_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    starting_reps: Mapped[int] = mapped_column(Integer, nullable=False)
    starting_sets: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    mesocycle: Mapped[Mesocycle] = relationship(back_populates="exercises")
    catalog: Mapped[ExerciseCatalog] = relationship()
    prescriptions: Mapped[list[Prescription]] = relationship(
        back_populates="mesocycle_exercise",
        cascade="all, delete-orphan",
        order_by="Prescription.week_number",
    )

    @property
    def base_prescription(self) -> Prescription | None:
        """La que vale para todo el bloque, si el coach puso alguna."""
        for p in self.prescriptions:
            if p.week_number is None:
                return p
        return None

    def prescription_for(self, week_number: int) -> Prescription | None:
        """La de esa semana concreta, si existe. No cae a la base."""
        for p in self.prescriptions:
            if p.week_number == week_number:
                return p
        return None


class Prescription(Base, TimestampMixin):
    """Lo que el coach fijo a mano. NULL = lo decide el motor.

    Tiene DOS dimensiones: el ejercicio y la semana.

    - `week_number` NULL es la prescripcion BASE: vale para todo el bloque.
    - `week_number` N sobrescribe solo esa semana.

    El orden al resolver la semana W es: fila de la semana W, si no la base, si
    no el motor. Eso es lo que permite que el coach paute las seis semanas a
    mano si quiere, o solo la tercera, sin que una cosa excluya a la otra: lo
    que no toca lo sigue ajustando el motor con el RIR y el feedback reales.

    `rest_seconds` es el unico campo NOT NULL porque el descanso SIEMPRE lo
    pauta el coach: no tiene modo automatico.
    """

    __tablename__ = "prescriptions"
    __table_args__ = (
        UniqueConstraint("mesocycle_exercise_id", "week_number"),
        CheckConstraint("week_number IS NULL OR week_number >= 1", name="semana_valida"),
        CheckConstraint("sets IS NULL OR sets >= 1", name="sets_positivos"),
        CheckConstraint("load_kg IS NULL OR load_kg > 0", name="carga_positiva"),
        CheckConstraint(
            "(rep_lo IS NULL AND rep_hi IS NULL) OR "
            "(rep_lo IS NOT NULL AND rep_hi IS NOT NULL AND rep_hi >= rep_lo)",
            name="rango_completo_o_vacio",
        ),
        CheckConstraint("rest_seconds > 0 AND rest_seconds <= 900", name="descanso_razonable"),
        CheckConstraint(
            "load_percent IS NULL OR (load_percent >= 30 AND load_percent <= 110)",
            name="pct_razonable",
        ),
        # Una fila fija kilos o fija un porcentaje del 1RM, nunca los dos: si
        # los dos convivieran no habria forma de saber cual gana al resolver.
        CheckConstraint("load_kg IS NULL OR load_percent IS NULL", name="carga_o_porcentaje"),
        # Indice parcial: impide DOS prescripciones base para el mismo
        # ejercicio. El UNIQUE de arriba no lo cubre, porque tanto SQLite como
        # Postgres consideran que dos NULL son distintos.
        #
        # Va declarado aqui, y no solo en la migracion que lo crea, porque si
        # no el modelo y la base discrepan: en Postgres `alembic check` lo ve
        # reflejado, no lo encuentra en los modelos y propone BORRARLO. Un
        # --autogenerate a ciegas habria generado esa migracion y tirado la
        # unica proteccion que hay contra dos bases simultaneas.
        Index(
            "uq_prescriptions_base",
            "mesocycle_exercise_id",
            unique=True,
            sqlite_where=text("week_number IS NULL"),
            postgresql_where=text("week_number IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    mesocycle_exercise_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("mesocycle_exercises.id", ondelete="CASCADE"),
        nullable=False,
    )

    #: NULL = vale para todas las semanas. N = solo para la semana N.
    week_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    sets: Mapped[int | None] = mapped_column(Integer, nullable=True)
    load_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Porcentaje del 1RM vigente del atleta. Se resuelve a kilos en el
    #: servicio (`app/services/records.py::load_from_percent`), nunca aqui:
    #: este modulo no sabe que existe una marca.
    load_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    rep_lo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rep_hi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_rir: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rest_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=DEFAULT_REST_SECONDS
    )

    #: Que coach la firmo. Para el historial de "quien cambio esto".
    set_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    mesocycle_exercise: Mapped[MesocycleExercise] = relationship(back_populates="prescriptions")
