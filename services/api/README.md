# cage-api

Backend de **The Cage 2.0**. Fase 2.

## Estado

| Capa | Estado |
|---|---|
| `app/domain/` — motor de autorregulación | **Hecho y verificado** contra los 1 764 casos golden |
| `app/models/` — tablas SQLAlchemy | Pendiente |
| `alembic/` — migraciones | Pendiente |
| `app/core/security.py` — Argon2id + JWT | Pendiente |
| `app/api/v1/` — endpoints | Pendiente |

## Arrancar

Necesitas **Python 3.11 o superior**. Comprueba con `python --version`.

```powershell
cd services\api
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

Si PowerShell bloquea el script de activación:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Es solo para esa ventana; no cambia nada del sistema.

## Los tests

```powershell
pytest -q
```

Deberías ver **1 766 tests en verde** en un par de segundos. No levantan base de
datos ni servidor: el dominio es puro a propósito.

## El test que importa

`tests/test_engine_contract.py` lee `packages/engine/golden/cases.json` —el
MISMO archivo que usa el motor de TypeScript del móvil— y comprueba que este
port produce exactamente lo mismo en los 1 764 casos.

Si ese test falla, las dos implementaciones han divergido. No es
necesariamente un error, pero tiene que ser una decisión consciente:

1. Sube `POLICY_VERSION` en `app/domain/policy.py` **y** en
   `packages/engine/src/policy.ts`.
2. Regenera con `npm run golden` desde la raíz.
3. Revisa el diff caso por caso antes de mergear.

**Nunca arregles ese test tocando la tolerancia.**

## Las tres trampas del port, ya resueltas

Están comentadas en `app/domain/math_utils.py`, pero conviene saberlas:

- **Redondeo.** `Math.round` de JavaScript redondea .5 hacia +infinito;
  `round()` de Python usa redondeo bancario (`round(2.5) == 2`) y `Decimal`
  con `ROUND_HALF_UP` se aleja del cero (`-2.5 → -3`). Ninguno de los dos vale.
  La definición exacta de JS es `floor(x + 0.5)`.
- **Enteros desde texto.** `parseInt("12abc")` da `12`; `int("12abc")` revienta.
- **Signo menos Unicode.** `−1 set` usa U+2212, no el guion ASCII.

## Reglas de la casa

- **Todo en kilogramos.** Las libras son presentación del cliente.
- **El dominio es puro.** `app/domain/` no importa SQLAlchemy, ni FastAPI, ni
  toca red. Si algo de ahí necesita la base de datos, va en `app/services/`.
- **El servidor manda.** El móvil calcula lo mismo para responder sin señal,
  pero lo que se persiste sale de aquí.
