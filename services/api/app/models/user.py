"""Usuarios, roles y la relacion coach-atleta.

El modelo de permisos del producto, tal cual lo pidio el cliente:

    el motor sugiere, el coach decide, el atleta ejecuta

El coach es admin sobre SUS atletas, no sobre todos. La tabla que lo define es
`coach_athletes`; cualquier endpoint que devuelva datos de un atleta tiene que
comprobarla. Es el unico sitio donde vive esa autoridad.
"""

from __future__ import annotations

import uuid
from datetime import date as Date
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy import (
    Date as SADate,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid
from app.models._helpers import enum_check


class UserRole(StrEnum):
    #: Dueno del gimnasio. Da de alta cuentas y cobra. No entrena ni entrena a
    #: nadie: es una funcion administrativa, no una deportiva.
    ADMIN = "admin"
    COACH = "coach"
    ATHLETE = "athlete"


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        enum_check("role", UserRole, "role_valido"),
        CheckConstraint("email = lower(email)", name="email_minusculas"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)

    #: Siempre en minusculas. El CHECK lo impone en la base para que da igual
    #: por donde entre el dato: no puede haber dos cuentas que solo difieran en
    #: mayusculas.
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)

    #: Argon2id. Nunca la contrasena en claro, nunca un hash reversible.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)

    #: Baja logica. Se desactiva en vez de borrar para no romper el historico
    #: de entrenamientos, que es el activo real del producto.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    #: True mientras arrastre la contrasena provisional que le dio el admin.
    #: Mientras lo sea, la API solo le deja cambiarla. Es lo que hace que el
    #: admin deje de conocer la contrasena de sus clientes.
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    @property
    def is_coach(self) -> bool:
        return self.role == UserRole.COACH

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN


class CoachAthlete(Base):
    """Que atletas lleva cada coach. Sin fila aqui, no hay autoridad."""

    __tablename__ = "coach_athletes"
    __table_args__ = (CheckConstraint("coach_id <> athlete_id", name="no_autoasignacion"),)

    coach_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    athlete_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    coach: Mapped[User] = relationship(foreign_keys=[coach_id])
    athlete: Mapped[User] = relationship(foreign_keys=[athlete_id])


class RefreshToken(Base):
    """Token de refresco, guardado como hash.

    Se guarda el hash y no el token por la misma razon que las contrasenas: si
    alguien lee la tabla, no se lleva sesiones utilizables. `revoked_at`
    permite cerrar sesion en un dispositivo sin tocar los demas.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Membership(Base):
    """Un periodo pagado por un atleta.

    Se guarda como HISTORIAL, no como una fecha en `users` que se sobrescriba.
    La diferencia importa: con una sola fecha, renovar borra la anterior y no
    queda rastro de quien pago que mes. Con filas, el historial de cobros esta
    ahi sin montar nada aparte.

    El acceso de un atleta se resuelve preguntando si HOY cae dentro de algun
    periodo suyo. Dos periodos solapados no rompen nada: gana el que termina
    mas tarde.

    Los coaches no tienen filas aqui. Su acceso no caduca: son personal, no
    clientes.
    """

    __tablename__ = "memberships"
    __table_args__ = (CheckConstraint("ends_on >= starts_on", name="periodo_coherente"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    athlete_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    #: Ambos INCLUSIVE. El ultimo dia pagado cuenta entero: nadie pierde su
    #: entrenamiento del dia que vence por una comparacion estricta.
    starts_on: Mapped[Date] = mapped_column(SADate, nullable=False)
    ends_on: Mapped[Date] = mapped_column(SADate, nullable=False)

    #: Quien lo registro. Siempre un admin.
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    #: Texto libre: "efectivo", "transferencia", "le debo medio mes"...
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    athlete: Mapped[User] = relationship(foreign_keys=[athlete_id])
