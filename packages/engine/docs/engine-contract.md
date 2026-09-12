# Contrato del motor · TypeScript ↔ Python

El motor se ejecuta **en dos sitios**:

- **En el teléfono** (`@cage/engine`, este paquete) para que la app responda al
  instante y siga funcionando sin señal, que es la condición normal dentro de un
  gimnasio.
- **En el servidor** (`app/domain/autoregulation.py`, Fase 2) como fuente de
  verdad: es lo que se persiste y lo que ve el coach.

Dos implementaciones de la misma regla se separan solas. `golden/cases.json` es
lo que lo impide: **1 764 casos** generados desde la implementación TypeScript
que el test de Python lee tal cual.

---

## Reglas de convivencia

1. **El servidor manda.** Si el cálculo local y el del servidor difieren, gana el
   del servidor y la app reemplaza su valor optimista sin avisar al usuario.
2. **La app nunca persiste un plan.** Persiste sets ejecutados; los planes los
   recalcula o los pide.
3. **Todo plan lleva `policyVersion`.** Si el servidor devuelve una versión que
   la app no conoce, la app deja de calcular en local y usa solo la respuesta
   del servidor. Es la válvula de escape para cambiar reglas sin forzar
   actualización de la app.
4. **Cualquier cambio de regla toca los dos lados en el mismo PR**, sube
   `POLICY_VERSION` y regenera los casos golden.

---

## Invariantes que ninguna implementación puede romper

| Invariante | Motivo |
|---|---|
| Todas las cargas en kilogramos | Las libras son presentación; mezclarlas corrompe el histórico |
| `loadKg` siempre es múltiplo de `loadIncrementKg` | Una carga no montable es un bug de producto |
| `sets >= 2` | Suelo de `MIN_HARD_SETS` |
| `why` nunca vacío | La explicación es el diferenciador del producto (ver H-09 de la auditoría) |
| El feedback se guarda con los literales en español | El histórico no debe depender de una tabla de traducción |

---

## Trampas del port a Python

### 1. Redondeo

`Math.round()` de JavaScript es **half-up**; `round()` de Python es
**half-to-even**. `Math.round(2.5) === 3` pero `round(2.5) == 2`. Esto aparece
en dos sitios: `roundHalfUp(steps * factor)` con agresividad Baja, y `roundTo()`.

```python
from decimal import Decimal, ROUND_HALF_UP

def round_half_up(v: float) -> int:
    return int(Decimal(str(v)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

def round_to(v: float, increment: float) -> float:
    steps = round_half_up(v / increment)
    return float(Decimal(str(steps * increment)).quantize(Decimal("0.000001")))
```

### 2. Coma flotante

Usar `Decimal` para las cargas persistidas y `float` solo dentro del cálculo.
En la base, `NUMERIC(6,2)`, nunca `FLOAT`.

### 3. Reps como texto

`planSets` recibe las reps tal como las tecleó el atleta y aplica
`parseInt(x, 10) || 0`. El equivalente exacto en Python:

```python
def parse_reps(raw: str | None) -> int:
    if not raw:
        return 0
    match = re.match(r"^\s*[-+]?\d+", raw)
    return int(match.group()) if match else 0
```

Ojo: `parseInt("12abc")` es `12` en JS. Un `int("12abc")` en Python lanza.

### 4. Caracteres

`setNote` usa el signo menos Unicode **U+2212** (`−`), no el guion ASCII.
Compararlo con `"-1 set"` falla silenciosamente.

---

## Test de contrato en Python (Fase 2)

`tests/test_engine_contract.py`:

```python
import json
from pathlib import Path

import pytest

from app.domain.autoregulation import plan_exercise, plan_sets
from app.domain.schemas import Exercise, Feedback, SetLogEntry

GOLDEN = json.loads(
    (Path(__file__).parents[2] / "packages/engine/golden/cases.json").read_text("utf-8")
)


def test_policy_version_matches():
    from app.domain.policy import POLICY_VERSION
    assert GOLDEN["policyVersion"] == POLICY_VERSION


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: c["id"])
def test_engine_matches_typescript(case):
    payload = case["input"]
    exercise = Exercise.model_validate(payload["exercise"])
    feedback = (
        Feedback.model_validate(payload["feedbackOverride"])
        if payload["feedbackOverride"]
        else None
    )
    log = [
        SetLogEntry.model_validate(e) if e else None
        for e in payload["log"]
    ]

    plan = plan_exercise(exercise, payload["aggressiveness"], feedback)
    assert plan.model_dump(by_alias=True) == case["expected"]["plan"]

    sets = plan_sets(exercise, plan, log)
    assert [s.model_dump(by_alias=True) for s in sets] == case["expected"]["sets"]
```

Con `by_alias=True` y alias camelCase en los modelos Pydantic, la comparación es
directa contra el JSON generado por TypeScript, sin capa de traducción.

---

## Cómo regenerar los casos

```bash
npm run golden     # reescribe golden/cases.json
npm test           # verifica que el motor sigue produciendo lo mismo
```

Regenerar sin haber cambiado una regla a propósito produce un diff vacío. Si el
diff no está vacío y no sabes por qué, no lo mergees.
