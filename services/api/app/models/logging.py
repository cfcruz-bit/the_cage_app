"""Sesiones de entrenamiento, sets registrados y feedback.

Aqui esta la parte del esquema que mas cuidado necesita, por dos razones.

**1. El plan se congela.** `session_exercises` guarda la carga, los sets y la
`policy_version` con los que se genero la sesion. No se recalcula al leer. Si
manana cambian las reglas del motor, el historico sigue contando lo que de
verdad paso, y se puede saber con que version de la politica se produjo.

**2. La idempotencia.** `set_logs.client_id` es el UUID que genera el TELEFONO
(`newClientId()` en `apps/mobile/src/db/index.ts`). El atleta entrena en un
sotano sin cobertura: la cola de sincronizacion de la Fase 3 va a reintentar
los mismos POST varias veces. Con `client_id` UNIQUE, el segundo intento
actualiza en vez de duplicar. Sin el, un set contaria dos veces y el motor
subiria cargas por un fantasma.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid
from app.domain.schemas import JointPain, Pump, Soreness, WorkloadFeel
from app.models._helpers import enum_check


class TrainingSession(Base, TimestampMixin):
    """Un dia de entrenamiento dentro de un mesociclo."""

    __tablename__ = "training_sessions"
    __table_args__ = (
        CheckConstraint("week_number >= 1", name="semana_positiva"),
        CheckConstraint("day_number >= 1", name="dia_positivo"),
        CheckConstraint(
            "completed_at IS NULL OR started_at IS NOT NULL",
            name="no_se_cierra_sin_abrir",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    mesocycle_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("mesocycles.id", ondelete="CASCADE"), nullable=False, index=True
    )

    week_number: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Dia del mesociclo (1..days_per_week). `day_label` es texto libre y en los
    #: mesociclos viejos dice cualquier cosa: sin esto no se sabe que dias de la
    #: semana faltan.
    day_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    day_label: Mapped[str] = mapped_column(String(60), nullable=False)
    is_deload: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    exercises: Mapped[list[SessionExercise]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionExercise.position",
    )


class SessionExercise(Base, TimestampMixin):
    """El plan del motor, congelado en el momento de generar la sesion."""

    __tablename__ = "session_exercises"
    __table_args__ = (
        UniqueConstraint("session_id", "mesocycle_exercise_id"),
        CheckConstraint("planned_sets >= 1", name="sets_planificados"),
        CheckConstraint(
            "planned_load_kg IS NULL OR planned_load_kg > 0", name="carga_planificada"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("training_sessions.id", ondelete="CASCADE"), nullable=False
    )
    mesocycle_exercise_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("mesocycle_exercises.id", ondelete="RESTRICT"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    #: NULL cuando se congelo sin ningun peso del que partir (ver el docstring
    #: de `MesocycleExercise.starting_load_kg`). El atleta escribe el suyo en
    #: la propia sesion; ese registro es lo que alimenta la PROXIMA.
    planned_load_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    planned_sets: Mapped[int] = mapped_column(Integer, nullable=False)

    #: Version de las reglas con las que se calculo. Sin esto el historico no
    #: se puede interpretar cuando la politica cambie.
    policy_version: Mapped[str] = mapped_column(String(16), nullable=False)

    #: La explicacion en lenguaje natural que vio el atleta.
    why: Mapped[str] = mapped_column(Text, nullable=False, default="")

    session: Mapped[TrainingSession] = relationship(back_populates="exercises")
    set_logs: Mapped[list[SetLog]] = relationship(
        back_populates="session_exercise",
        cascade="all, delete-orphan",
        order_by="SetLog.idx",
    )
    feedback: Mapped[ExerciseFeedback | None] = relationship(
        back_populates="session_exercise",
        cascade="all, delete-orphan",
        uselist=False,
    )


class SetLog(Base, TimestampMixin):
    """Un set registrado por el atleta."""

    __tablename__ = "set_logs"
    __table_args__ = (
        UniqueConstraint("session_exercise_id", "idx"),
        CheckConstraint("idx >= 0", name="indice_no_negativo"),
        CheckConstraint("weight_kg IS NULL OR weight_kg >= 0", name="peso_valido"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)

    #: UUID generado por el telefono. Clave de idempotencia del POST /sync/sets.
    client_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)

    session_exercise_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("session_exercises.id", ondelete="CASCADE"), nullable=False
    )
    idx: Mapped[int] = mapped_column(Integer, nullable=False)

    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)

    #: Texto, no entero, igual que en el cliente: el atleta teclea "8" pero
    #: tambien "8+2" en un myorep. El motor lo lee con parse_leading_int.
    reps: Mapped[str | None] = mapped_column(String(16), nullable=True)
    rpe: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sub_sets: Mapped[str | None] = mapped_column(String(32), nullable=True)

    done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    #: Cuando lo marco el atleta EN SU TELEFONO, que puede ser horas antes de
    #: que llegue al servidor. No lo confundas con created_at.
    logged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session_exercise: Mapped[SessionExercise] = relationship(back_populates="set_logs")


class ExerciseFeedback(Base, TimestampMixin):
    """Feedback subjetivo post-ejercicio. Es lo que alimenta al motor.

    Los valores se guardan como los literales que ve el atleta ("Aun me
    duele", "Increible"), no como codigos. Asi el historico no depende de una
    tabla de traduccion que se puede perder, y coincide con lo que espera el
    motor sin conversion por medio.
    """

    __tablename__ = "exercise_feedback"
    __table_args__ = (
        enum_check("joint", JointPain, "dolor_valido"),
        enum_check("soreness", Soreness, "agujetas_validas"),
        enum_check("pump", Pump, "pump_valido"),
        enum_check("volume", WorkloadFeel, "volumen_valido"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    session_exercise_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("session_exercises.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    joint: Mapped[str] = mapped_column(String(32), nullable=False)
    soreness: Mapped[str] = mapped_column(String(32), nullable=False)
    pump: Mapped[str] = mapped_column(String(32), nullable=False)
    volume: Mapped[str] = mapped_column(String(32), nullable=False)

    session_exercise: Mapped[SessionExercise] = relationship(back_populates="feedback")
