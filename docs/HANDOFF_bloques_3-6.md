# The Cage 2.0 — Instrucciones para los bloques 3 a 6

Documento de traspaso. Quien lo lea (persona o agente) tiene que poder terminar el trabajo **sin reabrir decisiones que el dueño ya tomó** y **sin volver a caer en errores que ya costaron tiempo**. Léelo entero antes de tocar código.

---

## 0. Antes de empezar: guarda lo que ya está hecho

Los bloques 1 y 2 están terminados y verificados, **pero sin commitear**. Primero:

```powershell
cd C:\Users\cruzm\source\the-cage\services\api
.\.venv\Scripts\python.exe -m pytest -q          # deben salir 1938 passed
cd C:\Users\cruzm\source\the-cage
git add -A
git commit -m "Bloques 1 y 2: grupo BASICOS, ejercicios de la libreta y marcas de 1RM"
```

Si pytest no sale en 1938 verdes, **para** y averigua por qué antes de seguir.

---

## 1. Qué es esto

App de entrenamiento para un gimnasio de powerlifting en Nicaragua. Monorepo con npm workspaces:

| Carpeta | Qué es |
|---|---|
| `packages/engine` | Motor de autorregulación en TypeScript (lo usa la app para calcular sin señal) |
| `apps/mobile` | App Expo SDK 57 + expo-router, offline-first con SQLite |
| `services/api` | FastAPI + SQLAlchemy 2.0 async + Alembic. **El servidor manda.** |

Producción: API en Fly.io (`the-cage-api`, región `iad`), base PostgreSQL en Neon (us-east-2), APK por EAS (`eas build -p android --profile preview`).

Todo en la base va en **kilos**. Las libras son solo una preferencia de pantalla.

---

## 2. Lo que ya está hecho

### Bloque 1 — Grupo BASICOS y ejercicios de la libreta
- `MuscleGroup.BASICOS` en `app/domain/schemas.py` (primero de la lista).
- Migración `20260921_a1c7d3e4b592_grupo_basicos.py`: reescribe el CHECK `ck_exercise_catalog_musculo_valido`.
- `scripts/seed_exercises.py`: 12 básicos (banca competición/tempo/agarre medio/agarre cerrado/5ct/3ct/larsen, sentadilla lowbar/highbar/SSB/tempo, peso muerto pausa) + 5 accesorios. 67 ejercicios en total.
- `apps/mobile/src/lib/muscles.ts`: `BASICOS` → "Básicos", primero en el orden.

### Bloque 2 — Marcas de 1RM
- Tabla `one_rep_maxes` (modelo `OneRepMax` en `app/models/training.py`): atleta, ejercicio, `value_kg`, `achieved_on` (fecha del TEST, no de escritura), `source` (`test`/`competicion`/`estimada`), `note`, `set_by_id`. UNIQUE (atleta, ejercicio, fecha).
- **Es un historial.** Ninguna marca sobrescribe a otra. La vigente es la de `achieved_on` más reciente, desempate por `created_at`.
- `app/services/records.py`:
  - `current_marks(session, athlete_id) -> dict[exercise_id, Mark]` — **una sola consulta** para todos los ejercicios. Úsala siempre en vez de preguntar ejercicio por ejercicio.
  - `current_mark(session, athlete_id, exercise_id) -> Mark | None`
  - `load_from_percent(one_rm_kg, percent, increment_kg)` — redondea al salto real del gimnasio.
  - `percent_from_load(one_rm_kg, load_kg)` — un decimal.
  - `PERCENT_MIN = 30`, `PERCENT_MAX = 110`.
- Endpoints en `app/api/v1/records.py`, bajo `/api/v1/athletes/{athlete_id}/records`:
  - `GET` (vigentes; `?onlyCurrent=false` para historial), `POST` (misma fecha = corrige), `DELETE /{record_id}`.
  - Coach que lleva al atleta y admin escriben. El atleta **lee las suyas y no escribe** (403). Lo ajeno es 404 para todos.
- Tests: `tests/test_api_records.py`, `tests/test_records_service.py`.

---

## 3. Decisiones del dueño — NO se reabren

Estas las tomó Camilo explícitamente. No las cambies ni las "mejores" sin preguntarle.

1. **Básicos: categoría propia**, separada de los músculos. Su volumen no suma a ningún objetivo muscular; eso está aceptado.
2. **Peso obligatorio SOLO en los básicos, y en CADA semana.** Normalmente se programan por **% del 1RM** del atleta.
3. **Accesorios: libres.** Sin peso de arranque. El atleta registra lo que levante y a partir de ahí el motor calcula.
4. **El 1RM vive en el perfil del atleta**, con fecha e historial (ya hecho, bloque 2).
5. **La celda de la tabla acepta `75%` o `102.5`.** Se distingue por el símbolo `%`.
6. **Paso 4 opcional al crear el mesociclo**: un botón para pautar semanas; si no lo pulsa, se crea y listo.
7. **No existe ningún peso inventado.** Donde no hay dato se muestra `—`. El `startingLoadKg: 20` actual de `NewMesoSheet.tsx` (≈ línea 255) es exactamente lo que el dueño pidió eliminar.

---

## 4. Reglas del repo y trampas conocidas

Cada una de estas costó un error real. Respétalas.

**Seguridad (ver docstring de `app/api/deps.py`)**
- El token identifica, la base autoriza: el rol y la relación coach-atleta se comprueban contra la base en cada petición.
- **404, no 403, para lo ajeno.** Un 403 confirma que el recurso existe.
- El atleta no escribe su plan ni sus marcas. 403 cuando intenta tocar lo suyo, 404 cuando intenta tocar lo ajeno.
- Si un endpoint recibe el id de un recurso y el de su dueño en la ruta, comprueba que coinciden (ver `delete_record`).

**FastAPI / Pydantic**
- El `alias_generator` de los DTO pasa a camelCase **solo el cuerpo**, NO los parámetros de query. Todo query param va con `Annotated[tipo, Query(alias="camelCase")]`. Este fallo ya se coló **dos veces** (`?athleteId=`, `?onlyCurrent=`) y en las dos el parámetro se ignoraba en silencio.
- Los endpoints hacen `await session.commit()` **explícito**. `get_session` no commitea solo; sin commit, lo escrito desaparece.
- La validación del cuerpo corre antes que los permisos: un test de permisos tiene que mandar un cuerpo **válido**, o recibirá 422 y pasará sin probar nada.

**Alembic**
- Alembic **no detecta los CHECK de una columna añadida** a una tabla existente, ni un cambio en la lista de valores de un CHECK. Escríbelos a mano y dilo en el docstring de la migración.
- Dentro de `batch_alter_table` el nombre del CHECK va **sin prefijo** (`"carga_planificada"`); fuera va con `op.f("ck_tabla_nombre")`. Mezclarlos produce `ck_tabla_ck_tabla_nombre`.
- Todo índice parcial debe estar declarado también en el modelo (`__table_args__`), o en Postgres `alembic check` propone borrarlo.
- Cada migración se verifica en **SQLite y en PostgreSQL**: `upgrade head` → `alembic check` limpio → `downgrade -1` → `upgrade head`. El `downgrade` tiene que funcionar con datos reales dentro.
- `tests/test_schema.py::EXPECTED_TABLES` lista las tablas; si creas una, añádela.

**Motor**
- **No cambies la semántica de `packages/engine` ni de `app/domain/autoregulation.py`.** Están atados por 1 764 casos golden. `LastPerformance.weight_kg` sigue siendo `float` obligatorio.
- La ausencia de peso se resuelve en la **capa de servicio** (`app/services/planning.py`), antes de llamar al motor, no dentro del motor.
- Tras cualquier cambio: `npm run golden` y `git diff --exit-code packages/engine/golden/cases.json` debe salir limpio.

**Método**
- Todo reemplazo de texto en un archivo comprueba que el texto viejo aparece **exactamente una vez**. Dos veces ya pasó que `ruff format` había reformateado el archivo y el reemplazo no hizo nada, en silencio.
- Después de escribir un archivo, **reléelo**. Ya pasó que una escritura reportó éxito y el archivo seguía igual.
- **Un test solo vale si falla cuando rompes lo que prueba.** Para cada test importante: rompe el código a propósito, confirma que el test falla, restaura. Ya pasó que un test de ordenación pasaba por casualidad porque `created_at` tiene resolución de segundo.
- Comentarios y docstrings en **español**, explicando el *porqué*, no el *qué*. Sigue el tono del resto del repo.
- `ruff check .` y `ruff format --check .` limpios. Línea máxima 96.

---

## 5. Bloque 3 — Prescripciones por porcentaje

**Objetivo:** una prescripción semanal puede fijar la carga como `%` del 1RM vigente, y el servidor la resuelve a kilos montables.

### Base de datos
Migración nueva sobre `prescriptions`:
- Columna `load_percent FLOAT NULL`.
- CHECK `pct_razonable`: `load_percent IS NULL OR (load_percent >= 30 AND load_percent <= 110)`.
- CHECK `carga_o_porcentaje`: `load_kg IS NULL OR load_percent IS NULL` — nunca los dos a la vez.
- Los dos CHECK escritos a mano (columna añadida). Declara también los CHECK en `__table_args__` del modelo `Prescription`.

### API
- `PrescriptionIn` (`app/api/dto.py`): `load_percent: float | None = Field(default=None, ge=30, le=110)` y un `model_validator` que rechace `load_kg` y `load_percent` juntos con 422 y un mensaje claro.
- `PrescriptionOut` y las celdas de `PlanGridOut`: añadir `load_percent`, `one_rm_kg` (la marca usada, o null) y `needs_one_rm: bool` (hay % pero el atleta no tiene marca).
- `set_prescription` en `app/api/v1/mesocycles.py`: guardar `load_percent`.

### Resolución (`app/services/planning.py`)
- Las funciones de resolución (`effective_prescription`, `resolve_plan`, `project_grid`) son síncronas. **No les metas consultas.** El llamador (asíncrono) obtiene `await current_marks(session, meso.athlete_id)` **una vez por petición** y pasa `one_rm_kg: float | None` para cada ejercicio.
- Regla: si la semana tiene `load_percent` y hay marca → `load_kg = load_from_percent(one_rm, pct, mex.load_increment_kg)`. Si hay `%` y no hay marca → `load_kg = None` y `needs_one_rm = True`.
- En `project_grid`, un `%` en la semana N también mueve el ancla (`anchor_load`) igual que hoy lo hace un `load_kg` fijado a mano.
- Generar sesión (`POST /sessions` en `app/api/v1/sessions.py`): si un ejercicio con `%` no tiene marca, responde **409** con `"Falta la marca de <nombre del ejercicio> para calcular el <pct>%"`. No generes la sesión a medias.
- **Los pesos se congelan al generar la sesión** (`session_exercises.planned_load_kg`). Cambiar la marca después cambia la tabla y las sesiones FUTURAS, nunca las ya generadas. Esto es lo que mantiene honesto el historial.

### Tests obligatorios (todos deben fallar si rompes el código)
- `75%` de una marca de 140 con incremento 2.5 → la celda muestra 105; `72%` → 100 (no 100.8).
- `%` sin marca → celda con `needsOneRm: true` y `loadKg: null`; generar sesión → 409.
- Registrar una marca después hace que la celda se resuelva.
- Subir la marca cambia la tabla pero **no** una sesión ya generada.
- `loadKg` y `loadPercent` juntos → 422. `%` de 25 o de 120 → 422.
- La base rechaza (IntegrityError) una fila con los dos campos, aunque la API lo impida.
- Migración: SQLite y Postgres, ida, check y vuelta.

**Hecho cuando:** todo lo anterior verde, `alembic check` limpio en los dos motores, golden sin diff.

---

## 6. Bloque 4 — Fuera el peso inventado

**Objetivo:** ningún peso existe si nadie lo dio. Básicos: carga obligatoria en cada semana. Accesorios: libres.

### Base de datos
Migración nueva:
- `mesocycle_exercises.starting_load_kg` → **NULL permitido**. Reescribir el CHECK `carga_inicial_positiva` a `starting_load_kg IS NULL OR starting_load_kg > 0`.
- `session_exercises.planned_load_kg` → **NULL permitido**. Reescribir el CHECK `carga_planificada` a `planned_load_kg IS NULL OR planned_load_kg > 0`.
- Actualizar los modelos (`Mapped[float | None]`) y sus CHECK en `__table_args__`.
- El `downgrade` tiene que poder correr con filas NULL dentro: decide qué hacer con ellas y documéntalo (por ejemplo, rellenar con el incremento del ejercicio antes de volver a NOT NULL). No dejes un downgrade que revienta.

### Creación del mesociclo
- `MesocycleExerciseIn.starting_load_kg` pasa a opcional.
- Añadir a `MesocycleExerciseIn` un campo `weeks: list[WeekLoadIn] = []`, donde `WeekLoadIn` = `week_number` + (`load_kg` **o** `load_percent`) + opcionales `sets`, `rep_lo`, `rep_hi`, `target_rir`. Cada entrada se guarda como una `Prescription` de esa semana.
- **Regla de servidor** en `POST /mesocycles`: para cada ejercicio cuyo catálogo sea `BASICOS`, tiene que haber carga (kg o %) en **todas** las semanas `1..total_weeks`. Si falta alguna → 422 que diga qué ejercicio y qué semanas. Para el resto de grupos no se exige nada.
- Un básico programado por % sin marca del atleta **se puede crear** (el coach puede testear el 1RM el primer día); la tabla lo marca y generar sesión devuelve 409 (bloque 3).

### Sesiones sin peso (`app/services/planning.py`, `app/api/v1/sessions.py`)
- `last_performance`: si no hay sesión completada **y** `starting_load_kg` es NULL, no hay último peso. No lo inventes.
- En ese caso **no llames al motor para la carga**: el ejercicio sale con `planned_load_kg = None`, series y reps de la prescripción (o los valores del ejercicio), y un `rationale` tipo `"Primera sesión: registra el peso que uses"`.
- En cuanto haya una sesión completada **con peso registrado**, `last_performance` devuelve ese peso real y el motor toma el control como siempre.
- Si se completó la sesión pero el atleta no apuntó peso, sigue sin peso: no lo deduzcas.
- Revisar todo uso de `planned_load_kg` y proteger el caso None: `sessions.py` (~líneas 331, 371-379, `delta_kg`), `analytics.py` (~línea 152, volumen: sin peso cuenta 0 o se omite, documenta cuál).
- `project_grid`: accesorio sin ancla → `load_kg` None en todas las semanas (la app pinta `—`), salvo desde la semana en que el coach fije kilos.

### App
- `apps/mobile/src/features/mesos/NewMesoSheet.tsx`: eliminar `startingLoadKg: 20`. En el paso 3:
  - Básicos: una fila por semana con un campo de carga que acepte `%` o kilos (mismo parser del bloque 5). Obligatorio; el botón CREAR queda deshabilitado mientras falte alguna semana, y se marca cuál.
  - Accesorios: sin campo de carga. Si el coach quiere fijar uno, lo hace en la tabla.
- `apps/mobile/src/api/types.ts`: `startingLoadKg` y `plannedLoadKg` pasan a `number | null`; `weeks` en el alta.
- `SessionExerciseCard.tsx` / `SetRow.tsx`: sin peso planificado → el campo de peso sale vacío con `—` de marcador y el atleta escribe el suyo. Nada de ceros.
- `apps/mobile/src/stores/workout.ts` y cualquier cálculo local con el motor: si `plannedLoadKg` es null, **no** ejecutar el motor local para ese ejercicio.

### Tests obligatorios
- Crear un mesociclo con un básico al que le falta la semana 3 → 422 que nombre el ejercicio y la semana.
- Crear con un accesorio sin carga → 201; la tabla muestra `null` en todas sus semanas.
- Primera sesión de un accesorio sin carga → `plannedLoadKg: null` y el rationale de primera sesión.
- Completar esa sesión con 40 kg registrados → la siguiente sesión ya trae una carga calculada por el motor a partir de 40.
- Completarla SIN peso registrado → la siguiente sigue en null.
- Migración: ida, check y vuelta **con filas NULL dentro** en SQLite y Postgres.
- `npm run typecheck` limpio.

---

## 7. Bloque 5 — La tabla semana a semana y la pantalla de marcas

### Parser de la celda
- Función pura `parseLoadInput(texto): { kind: 'percent', value } | { kind: 'kg', value } | { kind: 'empty' } | { kind: 'invalid', reason }` en `apps/mobile/src/lib/loadInput.ts`.
- Acepta: `75%`, `75 %`, `102.5`, **`102,5`** (teclados en español), vacío.
- Rechaza: `%` fuera de 30-110, kilos ≤ 0, texto.
- Si el usuario tiene la app en libras, un número sin `%` son **libras** y se convierten a kg antes de enviarlo. El `%` no depende de la unidad.
- **Tests:** la app móvil hoy no tiene runner. Añade `vitest` como devDependency de `apps/mobile`, un script `test` que solo corra `src/lib/**/*.test.ts`, inclúyelo en el `npm test` de la raíz y en `.github/workflows/ci.yml` (job `engine`). Cubre como mínimo: coma decimal, espacio antes del `%`, límites 30/110, libras.

### `PlanGrid.tsx`
- Celda con `%` y marca: `75% · 105 kg` (los kilos en la unidad del usuario).
- Celda con `%` sin marca: `75% · sin marca`, en color de aviso.
- Celda con kilos: `105 kg`.
- Celda sin nada: `—`.
- Básico con celda vacía: borde de error (es obligatorio).
- Se mantiene el punto rojo de "lo fijó el coach" y "vacío = vuelve a automático".

### Pantalla de marcas
- Desde el detalle del atleta en la pestaña de clientes: lista de marcas vigentes (ejercicio, kg, fecha, origen) y botón para ver el historial de cada una.
- Alta de marca: selector de ejercicio (por defecto filtrado a Básicos), kilos, fecha (por defecto hoy, **editable**), origen, nota.
- El atleta ve sus marcas en su perfil, **sin** botones de edición.
- Endpoints ya existen (bloque 2). Añadir las funciones en `apps/mobile/src/api/endpoints.ts` y los tipos en `types.ts`.

---

## 8. Bloque 6 — Paso 4 opcional al crear

- Al final del paso 3 de `NewMesoSheet`, dos botones: **CREAR** y **PAUTAR SEMANAS**.
- **CREAR**: igual que hoy.
- **PAUTAR SEMANAS**: crea el mesociclo (con la misma validación de básicos del bloque 4) y, en cuanto el servidor responde, muestra dentro del mismo sheet la `PlanGrid` del mesociclo recién creado, lista para editar. Cerrar el sheet no pierde nada: todo está ya guardado.
- Motivo de hacerlo así y no con una tabla "en borrador": la tabla ya trabaja contra el servidor, y duplicarla en modo local sería mantener dos versiones de la pantalla más compleja de la app.
- La tabla sigue accesible como hoy desde el detalle del mesociclo.

---

## 9. Verificación final (obligatoria antes de dar nada por hecho)

```powershell
cd C:\Users\cruzm\source\the-cage\services\api
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\ruff.exe format --check .
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\alembic.exe check

cd C:\Users\cruzm\source\the-cage
npm test
npm run typecheck
npm run golden
git diff --exit-code packages/engine/golden/cases.json
```

Y contra PostgreSQL real, al menos una vez por migración nueva (Neon tiene ramas gratuitas para esto, o un Postgres en Docker): `upgrade head` → `check` → `downgrade -1` → `upgrade head`.

Commitea al terminar cada bloque, no al final de los cuatro.

---

## 10. Desplegar

Cuando todo esté verde y commiteado:

```powershell
cd C:\Users\cruzm\source\the-cage\services\api
fly deploy                                                   # corre las migraciones solo
fly ssh console --command "python -m scripts.seed_exercises" # mete los ejercicios nuevos
```

La app móvil: los cambios de JavaScript se publican con `npx eas-cli@latest update --branch preview`; si se añadió alguna dependencia nativa, hace falta un APK nuevo con `npm run build:apk` desde `apps/mobile`.
