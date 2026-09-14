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
    Integer,
    String,
    UniqueConstraint,
    Uuid,
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


class Mesocycle(Base, TimestampMixin):
    """Un bloque de entrenamiento de un atleta.

    Solo lo crea un coach: es una regla de producto explicita del cliente. La
    base no la impone (coach_id podria apuntar a cualquiera), la imponen los
    endpoints comprobando `coach_athletes`.
    """

    __tablename__ = "mesocycles"
    __table_args__ = (
        enum_check("status", MesocycleStatus, "estado_valido"),
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
        CheckConstraint("starting_load_kg > 0", name="carga_inicial_positiva"),
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
    starting_load_kg: Mapped[float] = mapped_column(Float, nullable=False)
    starting_reps: Mapped[int] = mapped_column(Integer, nullable=False)
    starting_sets: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    mesocycle: Mapped[Mesocycle] = relationship(back_populates="exercises")
    catalog: Mapped[ExerciseCatalog] = relationship()
    prescription: Mapped[Prescription | None] = relationship(
        back_populates="mesocycle_exercise",
        cascade="all, delete-orphan",
        uselist=False,
    )


class Prescription(Base, TimestampMixin):
    """Lo que el coach fijo a mano. NULL = lo decide el motor.

    Espejo exacto de la interfaz `Prescription` del cliente. `rest_seconds` es
    el unico campo NOT NULL porque el descanso SIEMPRE lo pauta el coach: no
    tiene modo automatico.
    """

    __tablename__ = "prescriptions"
    __table_args__ = (
        CheckConstraint("sets IS NULL OR sets >= 1", name="sets_positivos"),
        CheckConstraint("load_kg IS NULL OR load_kg > 0", name="carga_positiva"),
        CheckConstraint(
            "(rep_lo IS NULL AND rep_hi IS NULL) OR "
            "(rep_lo IS NOT NULL AND rep_hi IS NOT NULL AND rep_hi >= rep_lo)",
            name="rango_completo_o_vacio",
        ),
        CheckConstraint("rest_seconds > 0 AND rest_seconds <= 900", name="descanso_razonable"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    mesocycle_exercise_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("mesocycle_exercises.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    sets: Mapped[int | None] = mapped_column(Integer, nullable=True)
    load_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
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

    mesocycle_exercise: Mapped[MesocycleExercise] = relationship(back_populates="prescription")
