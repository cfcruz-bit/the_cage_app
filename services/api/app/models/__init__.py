"""Todos los modelos, importados en un solo sitio.

Alembic necesita que TODAS las clases esten importadas antes de mirar
`Base.metadata`, o la autogeneracion creera que las tablas que faltan sobran y
escribira un `drop_table`. Por eso este archivo importa todo y lo reexporta:
`migrations/env.py` solo tiene que importar este modulo.
"""

from app.db.base import Base
from app.models.logging import (
    ExerciseFeedback,
    SessionExercise,
    SetLog,
    TrainingSession,
)
from app.models.training import (
    DEFAULT_REST_SECONDS,
    ExerciseCatalog,
    Mesocycle,
    MesocycleExercise,
    MesocycleStatus,
    Prescription,
)
from app.models.user import (
    CoachAthlete,
    Membership,
    RefreshToken,
    User,
    UserRole,
)

__all__ = [
    "DEFAULT_REST_SECONDS",
    "Base",
    "CoachAthlete",
    "ExerciseCatalog",
    "ExerciseFeedback",
    "Membership",
    "Mesocycle",
    "MesocycleExercise",
    "MesocycleStatus",
    "Prescription",
    "RefreshToken",
    "SessionExercise",
    "SetLog",
    "TrainingSession",
    "User",
    "UserRole",
]
