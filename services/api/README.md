# cage-api

Backend de **The Cage 2.0**. Fase 2.

## Estado

| Capa | Estado |
|---|---|
| `app/domain/` — motor de autorregulación | **Hecho y verificado** contra los 1 764 casos golden |
| `app/models/` — 11 tablas SQLAlchemy | **Hecho**, con 18 tests de esquema |
| `migrations/` — Alembic | **Hecho**, ida y vuelta probada |
| `app/core/security.py` — Argon2id + JWT | **Hecho** |
| `app/api/` — 15 endpoints + permisos | **Hecho**, con 29 tests de API |
| `app/domain/alerts.py` — reglas de alerta | **Hecho**, 18 tests puros |
| `app/services/analytics.py` + panel del coach | **Hecho**, 9 tests de API |
| `scripts/seed_exercises.py` — 50 ejercicios | **Hecho**, idempotente |
| Cola de sincronización del móvil | **Hecho** (`apps/mobile/src/sync/`) |
| Membresías, rol admin y panel web | **Hecho**, 33 tests |

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

Deberías ver **1 877 tests en verde** en un par de segundos. Los 1 766 del motor
no levantan nada —el dominio es puro a propósito—; los 111 del servidor crean una
SQLite temporal, la migran con Alembic y levantan la API real en memoria.

Tardan unos 20 segundos y casi todo es Argon2 hasheando contraseñas. Es
intencionado: si el login fuera rápido, sería porque el hash es débil.

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

## La base de datos

El esquema son **once tablas**. Las que importan entender:

- **`coach_athletes`** es donde vive la autoridad del coach. El coach es admin
  sobre *sus* atletas, no sobre todos. Cualquier endpoint que devuelva datos de
  un atleta tiene que consultarla.
- **`prescriptions`** son los *overrides* del coach, separados de
  `mesocycle_exercises` a propósito. Un campo en `NULL` significa "aquí manda el
  motor". Si estuvieran en la misma tabla no se podría distinguir "el coach puso
  3 sets" de "el motor calculó 3 sets", y esa distinción es justo lo que ve el
  coach en su pantalla.
- **`session_exercises`** congela el plan: carga, sets y `policy_version` del
  momento en que se generó la sesión. No se recalcula al leer. Cuando cambien
  las reglas, el histórico seguirá contando lo que de verdad pasó.
- **`set_logs.client_id`** es UNIQUE y lo genera el teléfono. Es la clave de
  idempotencia de la Fase 3: el mismo set reenviado tres veces desde un sótano
  sin cobertura tiene que seguir siendo una fila.

### Migraciones

```powershell
# aplicar todo lo pendiente
alembic upgrade head

# generar una revisión después de tocar un modelo
alembic revision --autogenerate -m "descripcion corta"

# ¿modelos y migraciones siguen alineados?
alembic check
```

La URL de la base **no** está en `alembic.ini`: la lee `migrations/env.py` de
`app/core/config.py`, que la toma del entorno. Un DSN con contraseña en un
archivo versionado es una fuga esperando a pasar. Por defecto usa SQLite; en
producción se define `DATABASE_URL=postgresql+asyncpg://...`.

**Nunca edites una revisión ya aplicada en cualquier entorno.** Los cambios van
en la siguiente.

Los tests crean su esquema con `alembic upgrade head`, no con
`Base.metadata.create_all()`. La diferencia no es cosmética: con `create_all`
podrías tener una migración rota y los tests seguirían verdes hasta el
despliegue.

## Levantar la API

```powershell
uvicorn app.main:app --reload
```

Documentación interactiva en `http://127.0.0.1:8000/docs`. En producción se
apaga: es un mapa completo de la superficie de ataque.

## Sembrar el catálogo

```powershell
python -m scripts.seed_exercises
```

Siembra 50 ejercicios del sistema, visibles para todos los coaches. Es
**idempotente** —identifica cada uno por (nombre, equipo)— así que se puede
correr en cada despliegue sin pensarlo.

Revisa los `load_increment_kg` contra TU gimnasio antes de darlo por bueno: es
el salto mínimo montable con el material real, y si no coincide, el motor
propondrá cargas imposibles de poner en la barra.

## Las alertas del coach

`app/domain/alerts.py` tiene cinco reglas, y son las que el prototipo mostraba
escritas a mano en `clients.ts`:

| Regla | Dispara cuando |
|---|---|
| `rir_al_limite` | 3 sesiones seguidas cerrando a RIR 0 |
| `dolor_articular` | 2 semanas seguidas con dolor moderado o alto |
| `e1rm_estancado` | 3 sesiones sin superar el e1RM de referencia |
| `adherencia_baja` | menos del 80% de sesiones completadas |
| `meso_terminando` | el bloque está en su última semana |

Las reglas son **puras**: reciben tuplas y devuelven alertas. Por eso cada una
se prueba con un caso de tres líneas en vez de montar un mesociclo entero.

Una alerta no es una orden. El coach decide; esto solo le ahorra revisar
cincuenta sesiones para encontrar las tres que importan.

## Cuentas, cobros y el panel de administración

**El registro público está cerrado.** En este producto las cuentas se dan, no se
piden: solo un administrador las crea.

### El primer administrador

Problema del huevo y la gallina: las cuentas las crea un admin y al principio no
hay ninguno. La salida es un script que corre contra la base, así que solo lo
puede usar quien ya tiene acceso al servidor:

```powershell
python -m scripts.create_admin
```

Pide email, nombre y contraseña por teclado. La contraseña no se acepta por
argumento a propósito: los argumentos quedan en el historial del shell.

### El panel

Con el servidor levantado, en `http://TU_IP:8000/admin`. Desde ahí se dan altas,
se renuevan meses y se regeneran contraseñas. Se sirve desde la propia API para
que comparta origen: sin CORS, sin despliegue aparte, sin un dominio más.

El token vive en memoria y no en `localStorage`. Por la computadora del gimnasio
pasa gente, y un token que sobrevive a cerrar la pestaña es un token que otro
puede usar. El precio es volver a entrar al recargar.

### El modelo de cobro

Cada pago es **una fila** en `memberships` con sus fechas, no una fecha que se
sobrescribe en `users`. Así el historial de cobros existe sin montar nada aparte.

- **Un atleta entra mientras hoy caiga dentro de un periodo pagado.** Coaches y
  admin no caducan: son personal, no clientes.
- **Las fechas son inclusivas.** El último día pagado cuenta entero.
- **Renovar antes de vencer SUMA días.** El periodo nuevo se encadena al final
  del actual, así que el cliente puntual no pierde días por pagar a tiempo.
- **A 5 días del vencimiento** la app muestra un aviso. Al vencer, la API
  responde **402** y el móvil enseña "Necesita renovar su pago".
- **Desactivar no borra.** Baja lógica: el histórico de entrenamientos es el
  activo real del producto.

### La contraseña provisional

Al crear una cuenta, el panel muestra una contraseña de 12 caracteres **una sola
vez**. No se guarda en claro en ningún sitio; si se pierde, se regenera.

Mientras el usuario la arrastre, la API solo le deja cambiarla. Eso es lo que
consigue que dejes de conocer la contraseña de tus clientes en cuanto entran. Al
cambiarla, el servidor revoca sus demás sesiones: si alguien se hizo con la
provisional, cambiarla tiene que echarlo.

El alfabeto de esas contraseñas excluye `O`, `0`, `l`, `1` e `I`. Una contraseña
que el cliente teclea mal tres veces es una llamada tuya.

## Los permisos

Todo el perímetro está en `app/api/deps.py`. Tres reglas que no se negocian:

1. **El token identifica; la base autoriza.** El JWT dice quién firmó la sesión.
   El rol y la relación coach–atleta se comprueban contra la base en *cada*
   petición, porque un token es una afirmación del pasado: el rol pudo cambiar,
   la cuenta pudo desactivarse, el atleta pudo dejar de ser cliente.
2. **404, no 403, para lo ajeno.** Si un coach pide el mesociclo de un atleta que
   no lleva, la respuesta es "no existe". Un 403 confirmaría que ese recurso
   existe, y eso ya es información.
3. **El atleta no escribe su plan.** Marca sets como hechos y reporta feedback.
   Carga, series, repeticiones, descanso y mesociclos los pauta el coach.
4. **El acceso del atleta caduca.** Sin periodo pagado vigente, 402 en todo
   salvo `/auth/me`, que es lo que le explica por qué.

`tests/test_api_permissions.py` tiene un test por cada frase que dijo el
cliente. Si uno falla, no es un bug técnico: es el producto haciendo algo que
no debe.

## Reglas de la casa

- **Todo en kilogramos.** Las libras son presentación del cliente.
- **El dominio es puro.** `app/domain/` no importa SQLAlchemy, ni FastAPI, ni
  toca red. Si algo de ahí necesita la base de datos, va en `app/services/`.
- **El servidor manda.** El móvil calcula lo mismo para responder sin señal,
  pero lo que se persiste sale de aquí.
- **Las reglas van en la base.** Un CHECK en Postgres protege contra un bug del
  backend, contra un script de migración de datos y contra alguien con `psql`
  abierto a las dos de la mañana. Una validación en Pydantic, no.
- **Los permisos se prueban, no se confían.** Cualquier endpoint nuevo que
  devuelva datos de un atleta necesita su test de "un coach ajeno recibe 404".
- **Nada de ENUM nativos.** Añadir un valor exige `ALTER TYPE`, que no corre
  dentro de la transacción de la migración. Se usa `VARCHAR` + `CHECK`, y el
  CHECK se genera desde los `StrEnum` de `app/domain/schemas.py` para que no
  puedan divergir.
