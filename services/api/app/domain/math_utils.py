"""Aritmética compartida del motor, replicando la semántica de JavaScript.

Esta es la parte del port con más trampas. Tres, concretamente:

1. **Redondeo.** `Math.round` de JavaScript NO es `round()` de Python.
   JS redondea .5 hacia +infinito (`Math.round(2.5) === 3`, `Math.round(-2.5)
   === -2`); Python usa redondeo bancario (`round(2.5) == 2`). Y `Decimal` con
   ROUND_HALF_UP tampoco vale, porque redondea alejándose del cero
   (`-2.5 → -3`). La definición exacta de JS es `floor(x + 0.5)`, y eso es lo
   que implementamos.

2. **Coma flotante.** Ambos lenguajes usan float64 IEEE-754, así que la misma
   secuencia de operaciones da bit a bit el mismo resultado. Por eso el port
   replica el orden de las operaciones en vez de "simplificar" la fórmula.

3. **Enteros desde texto.** `parseInt(x, 10)` de JS lee el número del principio
   e ignora la basura de detrás: `parseInt("12abc") === 12`. `int("12abc")`
   revienta. Ver `parse_leading_int`.
"""

from __future__ import annotations

import math
import re

from app.domain.policy import EPLEY_DIVISOR

_LEADING_INT = re.compile(r"^\s*[+-]?\d+")


def js_round(value: float) -> int:
    """Equivalente exacto de `Math.round` de JavaScript: floor(x + 0.5)."""
    return math.floor(value + 0.5)


def clamp(value: float, low: float, high: float) -> float:
    """Acota value al intervalo [low, high]."""
    return max(low, min(high, value))


def clamp_int(value: int, low: int, high: int) -> int:
    return int(max(low, min(high, value)))


def round_to(value: float, increment: float) -> float:
    """Redondea al múltiplo de `increment` más cercano.

    Sirve para que una carga siempre sea montable con el material disponible
    (mancuernas de 2.5 kg, placas de cable de 1.25 kg…). El paso final por 1e6
    limpia el ruido de coma flotante, igual que en TypeScript.
    """
    if increment <= 0:
        raise ValueError("increment debe ser > 0")
    rounded = js_round(value / increment) * increment
    return js_round(rounded * 1e6) / 1e6


def round6(value: float) -> float:
    """Limpia el ruido de coma flotante de una resta de cargas."""
    return js_round(value * 1e6) / 1e6


def e1rm(weight_kg: float, reps: float, rir: float) -> float:
    """1RM estimado por Epley extendido con RIR.

    e1RM = w · (1 + (reps + rir) / 30)

    Las reps se suman al RIR porque un set a RIR 2 equivale a uno con 2 reps
    más.
    """
    return weight_kg * (1 + (float(reps) + float(rir)) / EPLEY_DIVISOR)


def parse_leading_int(raw: str | None) -> int:
    """Equivalente de `parseInt(raw, 10) || 0`.

    Lee el entero del principio de la cadena y descarta lo que venga detrás.
    Devuelve 0 si no hay ningún número, que es lo que hace `NaN || 0` en JS.
    """
    if raw is None:
        return 0
    match = _LEADING_INT.match(raw)
    if match is None:
        return 0
    return int(match.group())
