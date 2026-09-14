"""Política de autorregulación.

Port directo de `packages/engine/src/policy.ts`. Los dos archivos tienen que
decir exactamente lo mismo: si cambias un valor aquí y no allí, los casos golden
lo detectan y el CI falla.

Cambiar cualquier constante de este módulo cambia los entrenamientos de todos
los atletas. Sube POLICY_VERSION cuando lo hagas y guárdala en
`session_exercises.policy_version`, para poder leer el histórico sabiendo con
qué reglas se produjo.
"""

from __future__ import annotations

from typing import Final

from app.domain.schemas import Aggressiveness

#: Versión de las reglas. Formato AAAA.MM. Debe coincidir con la de TypeScript.
POLICY_VERSION: Final[str] = "2026.09"

#: Divisor de la fórmula de Epley: 1RM ≈ w · (1 + (reps + rir) / 30).
EPLEY_DIVISOR: Final[int] = 30

#: Multiplicador de los saltos de carga según la agresividad del atleta.
AGGRESSIVENESS_FACTOR: Final[dict[Aggressiveness, float]] = {
    Aggressiveness.LOW: 0.5,
    Aggressiveness.MEDIUM: 1.0,
    Aggressiveness.HIGH: 1.5,
}

#: Con dolor articular severo se recorta la carga a este porcentaje.
JOINT_PAIN_LOAD_FACTOR: Final[float] = 0.95

#: Suelo de hard sets: por mucho que se recorte, nunca se baja de aquí.
MIN_HARD_SETS: Final[int] = 2

#: Tope de pasos de subida cuando el volumen se reportó "Al límite".
AT_LIMIT_MAX_STEPS: Final[int] = 1

#: Separador entre motivos acumulados dentro de un mismo plan.
REASON_SEPARATOR: Final[str] = " · "


class Reasons:
    """Textos de las explicaciones, literales de TypeScript.

    Viajan hasta la pantalla del atleta, así que un cambio aquí es un cambio de
    producto. El guion de "−1 rep" y de "−1 set" es el signo menos Unicode
    (U+2212), no el guion ASCII: compararlos con "-" falla en silencio.
    """

    RIR_OVERSHOOT: Final[str] = "te pasaste del RIR objetivo, se sostiene la carga"
    JOINT_PAIN: Final[str] = "dolor articular alto: se recorta carga y volumen"
    STILL_SORE: Final[str] = "seguías adolorido: misma carga esta semana"
    NO_SIGNAL: Final[str] = "sin señales para mover la carga"
    VOLUME_INSUFFICIENT: Final[str] = "reportaste volumen insuficiente"
    LOW_PUMP: Final[str] = "reportaste pump bajo"
    LOAD_UP: Final[str] = "subes carga: pasaste el tope del rango"
    FATIGUE_DROP: Final[str] = "misma carga, −1 rep por fatiga acumulada"
    EXPECTED_DROP: Final[str] = "caída esperada de ~1 rep"

    @staticmethod
    def rir_slack(last_rir: int, target_rir: int) -> str:
        return f"cerraste en RIR {last_rir} con objetivo {target_rir}"

    @staticmethod
    def rep_ceiling(rep_hi: int) -> str:
        return f"llegaste al tope de {rep_hi} reps"

    @staticmethod
    def back_off(rep_lo: int) -> str:
        return f"back-off: el set previo cayó bajo {rep_lo} reps"

    @staticmethod
    def added_set(reason: str) -> str:
        return f"set añadido: {reason}"


#: Notas de volumen. Signo menos Unicode, igual que en TypeScript.
SET_NOTE_ADD: Final[str] = "+1 set"
SET_NOTE_REMOVE: Final[str] = "−1 set"
