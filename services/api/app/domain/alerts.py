"""Reglas de alerta para el coach.

El prototipo mostraba frases como "Tres sesiones seguidas con RIR 0 en pecho.
Sugerencia: -1 hard set". Estaban escritas a mano en `clients.ts`. Esto es lo
que las genera de verdad.

Como el resto de `app/domain/`, este modulo es **puro**: recibe estructuras de
datos y devuelve alertas. No sabe que existe una base ni un HTTP. Por eso se
puede probar cada regla con un caso de tres lineas en vez de montar un
mesociclo entero.

Una alerta NO es una orden. El coach decide; esto solo le ahorra revisar
cincuenta sesiones a mano para encontrar las tres que importan.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from app.domain.math_utils import e1rm


class AlertKind(StrEnum):
    RIR_AL_LIMITE = "rir_al_limite"
    DOLOR_ARTICULAR = "dolor_articular"
    E1RM_ESTANCADO = "e1rm_estancado"
    ADHERENCIA_BAJA = "adherencia_baja"
    MESO_TERMINANDO = "meso_terminando"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"


#: Sesiones seguidas cerrando sin margen antes de avisar. Dos podrian ser un
#: mal dia; tres es un patron.
RIR_STREAK: Final[int] = 3

#: Semanas seguidas con dolor articular relevante.
PAIN_STREAK: Final[int] = 2

#: Sesiones sin mejorar el e1RM antes de sugerir deload.
PLATEAU_SESSIONS: Final[int] = 3

#: Margen por debajo del cual dos e1RM se consideran iguales. Un 1% arriba o
#: abajo es ruido de redondeo de placas, no progreso.
PLATEAU_TOLERANCE: Final[float] = 0.01

#: Adherencia por debajo de la cual se avisa.
LOW_ADHERENCE: Final[float] = 0.80


@dataclass(frozen=True)
class ExerciseHistory:
    """Lo que hizo un atleta en UN ejercicio, sesion a sesion.

    Las listas van de la mas ANTIGUA a la mas reciente. Todas tienen la misma
    longitud: una entrada por sesion completada.
    """

    exercise_name: str
    muscle: str
    #: RIR con el que cerro el primer set de cada sesion.
    rir_by_session: tuple[int, ...]
    #: Dolor articular reportado tras cada sesion, con los literales del motor.
    joint_by_session: tuple[str, ...]
    #: e1RM estimado de cada sesion.
    e1rm_by_session: tuple[float, ...]


@dataclass(frozen=True)
class Alert:
    kind: AlertKind
    severity: Severity
    #: Ejercicio o musculo al que se refiere. Vacio si es del mesociclo entero.
    subject: str
    text: str
    suggestion: str


def estimate_e1rm(weight_kg: float, reps: int, rir: int) -> float:
    """Reexportado para que quien monte el historico use la MISMA formula."""
    return e1rm(weight_kg, reps, rir)


def alerts_for_exercise(history: ExerciseHistory) -> list[Alert]:
    """Reglas que miran un solo ejercicio a lo largo del tiempo."""
    out: list[Alert] = []

    if _closing_streak(history.rir_by_session) >= RIR_STREAK:
        out.append(
            Alert(
                kind=AlertKind.RIR_AL_LIMITE,
                severity=Severity.WARNING,
                subject=history.exercise_name,
                text=(
                    f"{RIR_STREAK} sesiones seguidas cerrando a RIR 0 "
                    f"en {history.exercise_name}."
                ),
                suggestion=("Considera −1 hard set y mantener la carga la proxima semana."),
            )
        )

    if _pain_streak(history.joint_by_session) >= PAIN_STREAK:
        out.append(
            Alert(
                kind=AlertKind.DOLOR_ARTICULAR,
                severity=Severity.WARNING,
                subject=history.exercise_name,
                text=(
                    f"Dolor articular {PAIN_STREAK} semanas seguidas "
                    f"en {history.exercise_name}."
                ),
                suggestion=(
                    "Considera sustituirlo por una variante que cargue menos la articulacion."
                ),
            )
        )

    if _is_plateau(history.e1rm_by_session):
        out.append(
            Alert(
                kind=AlertKind.E1RM_ESTANCADO,
                severity=Severity.INFO,
                subject=history.exercise_name,
                text=(
                    f"El e1RM de {history.exercise_name} lleva "
                    f"{PLATEAU_SESSIONS} sesiones sin subir."
                ),
                suggestion="Considera un deload y volver a subir en saltos menores.",
            )
        )

    return out


def alerts_for_mesocycle(
    *,
    sessions_completed: int,
    sessions_planned: int,
    current_week_index: int,
    total_weeks: int,
) -> list[Alert]:
    """Reglas que miran el bloque entero, no un ejercicio."""
    out: list[Alert] = []

    if sessions_planned > 0:
        adherence = sessions_completed / sessions_planned
        if adherence < LOW_ADHERENCE:
            out.append(
                Alert(
                    kind=AlertKind.ADHERENCIA_BAJA,
                    severity=Severity.WARNING,
                    subject="",
                    text=(
                        f"Adherencia del {round(adherence * 100)}%: "
                        f"{sessions_completed} de {sessions_planned} sesiones."
                    ),
                    suggestion=(
                        "Habla con el atleta antes de ajustar cargas: el problema "
                        "puede no ser el plan."
                    ),
                )
            )

    if total_weeks > 0 and current_week_index >= total_weeks - 1:
        out.append(
            Alert(
                kind=AlertKind.MESO_TERMINANDO,
                severity=Severity.INFO,
                subject="",
                text="El mesociclo esta en su ultima semana.",
                suggestion="Genera el siguiente bloque antes de que termine.",
            )
        )

    return out


# ── Reglas, una por una ──────────────────────────────────────────────────────


def _closing_streak(rir_by_session: tuple[int, ...]) -> int:
    """Cuantas sesiones SEGUIDAS, contando desde la ultima, cerro a RIR 0.

    Se cuenta hacia atras desde el final a proposito: tres sesiones al limite
    hace dos meses no dicen nada del estado de hoy.
    """
    streak = 0
    for rir in reversed(rir_by_session):
        if rir > 0:
            break
        streak += 1
    return streak


#: Los literales del motor que cuentan como dolor relevante. "Poco" no entra:
#: algo de molestia es normal y avisar por eso seria ruido.
RELEVANT_PAIN: Final[frozenset[str]] = frozenset({"Moderado", "Mucho"})


def _pain_streak(joint_by_session: tuple[str, ...]) -> int:
    streak = 0
    for joint in reversed(joint_by_session):
        if joint not in RELEVANT_PAIN:
            break
        streak += 1
    return streak


def _is_plateau(e1rm_by_session: tuple[float, ...]) -> bool:
    """True si las ultimas PLATEAU_SESSIONS no mejoraron sobre la primera.

    Se compara contra la primera de la ventana, no cada una con la anterior:
    una subida y una bajada alternadas no son progreso, y encadenar
    comparaciones por pares las daria por buenas.
    """
    if len(e1rm_by_session) < PLATEAU_SESSIONS:
        return False

    window = e1rm_by_session[-PLATEAU_SESSIONS:]
    baseline = window[0]
    if baseline <= 0:
        return False

    ceiling = baseline * (1 + PLATEAU_TOLERANCE)
    return all(value <= ceiling for value in window[1:])
