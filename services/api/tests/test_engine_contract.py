"""Contrato ejecutable entre el motor de TypeScript y el de Python.

Lee `packages/engine/golden/cases.json` —el MISMO archivo que versiona el
paquete del cliente— y comprueba que este port produce exactamente lo mismo
para los 1 764 casos.

Si este test falla, las dos implementaciones han divergido. Eso no es
necesariamente un error, pero tiene que ser una decisión consciente: sube
POLICY_VERSION en los dos lados, regenera con `npm run golden` y revisa el diff
caso por caso antes de mergear.

Nunca "arregles" este test tocando las tolerancias.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.autoregulation import plan_exercise, plan_sets
from app.domain.policy import POLICY_VERSION
from app.domain.projection import project_mesocycle
from app.domain.schemas import (
    Aggressiveness,
    Exercise,
    Feedback,
    SetLogEntry,
)

#: services/api/tests/… → raíz del repo
REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN_PATH = REPO_ROOT / "packages" / "engine" / "golden" / "cases.json"

#: Las dos implementaciones usan float64 y la misma secuencia de operaciones,
#: así que los resultados deberían ser idénticos bit a bit. La tolerancia existe
#: solo para que un fallo real se lea como un fallo y no como ruido del último
#: dígito.
TOLERANCE = 1e-9


def _load_golden() -> dict[str, Any]:
    if not GOLDEN_PATH.exists():
        pytest.skip(
            f"No se encuentra {GOLDEN_PATH}. Genera los casos con "
            "`npm run golden` desde la raíz del repo."
        )
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


GOLDEN = _load_golden()
CASES = GOLDEN["cases"]


def test_policy_version_matches() -> None:
    """Las dos implementaciones declaran la misma versión de reglas."""
    assert GOLDEN["policyVersion"] == POLICY_VERSION


def test_golden_file_is_complete() -> None:
    assert len(CASES) == GOLDEN["caseCount"]
    assert GOLDEN["caseCount"] > 500


def _compare(actual: Any, expected: Any, path: str) -> list[str]:
    """Diferencias entre dos estructuras, con la ruta del campo que falla."""
    diffs: list[str] = []

    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: se esperaba un objeto"
        for key in expected:
            diffs += _compare(actual.get(key), expected[key], f"{path}.{key}")
        for key in actual:
            if key not in expected:
                diffs.append(f"{path}.{key}: sobra en Python ({actual[key]!r})")
        return diffs

    if isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            got = len(actual) if isinstance(actual, list) else type(actual).__name__
            diffs.append(f"{path}: longitud {got} vs {len(expected)}")
            return diffs
        for i, item in enumerate(expected):
            diffs += _compare(actual[i], item, f"{path}[{i}]")
        return diffs

    if isinstance(expected, bool) or isinstance(actual, bool):
        if actual != expected:
            diffs.append(f"{path}: {actual!r} vs {expected!r}")
        return diffs

    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        if abs(actual - expected) > TOLERANCE:
            diffs.append(f"{path}: {actual!r} vs {expected!r}")
        return diffs

    if actual != expected:
        diffs.append(f"{path}: {actual!r} vs {expected!r}")
    return diffs


def _case_id(case: dict[str, Any]) -> str:
    return str(case["id"])


@pytest.mark.parametrize("case", CASES, ids=_case_id)
def test_engine_matches_typescript(case: dict[str, Any]) -> None:
    payload = case["input"]

    exercise = Exercise.model_validate(payload["exercise"])
    aggressiveness = Aggressiveness(payload["aggressiveness"])
    override = (
        Feedback.model_validate(payload["feedbackOverride"])
        if payload["feedbackOverride"] is not None
        else None
    )
    log: list[SetLogEntry | None] = [
        SetLogEntry.model_validate(e) if e is not None else None for e in payload["log"]
    ]

    expected = case["expected"]

    plan = plan_exercise(exercise, aggressiveness, override)
    diffs = _compare(plan.model_dump(by_alias=True), expected["plan"], "plan")

    sets = plan_sets(exercise, plan, log)
    diffs += _compare([s.model_dump(by_alias=True) for s in sets], expected["sets"], "sets")

    weeks = project_mesocycle(exercise, plan)
    diffs += _compare(
        [w.model_dump(by_alias=True) for w in weeks],
        expected["projection"],
        "projection",
    )

    assert not diffs, "El motor de Python difiere del de TypeScript:\n  " + "\n  ".join(diffs)
