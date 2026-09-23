# Bloque 7 — Días de entrenamiento dentro del mesociclo

Continúa `docs/HANDOFF_bloques_3-6.md`. **Todas las reglas y trampas de la sección 4 de aquel documento siguen vigentes** (alias en query params, CHECK que Alembic no detecta, `session.commit()` explícito, 404 vs 403, romper el código para comprobar que el test falla, comentarios en español explicando el porqué). Léelas antes de empezar si no las tienes frescas.

---

## 1. El problema

Hoy un mesociclo es una lista plana de ejercicios y `POST /mesocycles/{id}/sessions` mete **todos** en la misma sesión. El "día" existe solo como `training_sessions.day_label`, un texto libre que el coach escribe al generar.

Eso hace imposible lo que el gimnasio necesita: repartir el bloque en Día 1 = banca y empuje, Día 2 = sentadilla y pierna, etc.

---

## 2. Decisiones ya tomadas por el dueño — NO se reabren

1. **El reparto es fijo para todo el mesociclo.** Día 1 lleva los mismos ejercicios las 6 semanas. Lo que cambia por semana son cargas y volumen, no qué ejercicio va qué día.
2. **Cada día tiene número y, opcionalmente, nombre.** "Día 1" por defecto; "Día 1 · Empuje" si el coach lo escribe. El nombre nunca es obligatorio.
3. **Al atleta se le ofrece el siguiente día sin completar.** No elige. Si se salta uno, se le sigue ofreciendo hasta que lo haga o hasta que empiece la semana siguiente.

---

## 3. Base de datos

### `mesocycles`
- Columna `days_per_week INT NOT NULL DEFAULT 1`, CHECK `dias_por_semana`: `days_per_week >= 1 AND days_per_week <= 7`.
- Quita el `server_default` después de rellenar las filas existentes, como se hizo con `goal` en la migración `9a1c36985ffd`. El valor real lo decide la aplicación.

### `mesocycle_exercises`
- Columna `day_number INT NOT NULL DEFAULT 1`, CHECK `dia_positivo`: `day_number >= 1`.
- El tope contra `days_per_week` **no** se puede poner como CHECK de tabla (está en otra fila). Lo valida la API. Dilo en el docstring de la migración para que nadie lo busque.
- **Cambia el UNIQUE**: hoy es `(mesocycle_id, position)`; pasa a `(mesocycle_id, day_number, position)`. El orden es dentro del día, no del bloque.
  - Al migrar, las filas existentes quedan todas en el día 1 y sus `position` ya son únicos por mesociclo, así que no hay colisiones. Compruébalo igualmente antes de crear el índice.

### Tabla nueva `mesocycle_days`
Solo para los nombres. Una fila por día **que tenga nombre**; sin nombre no hay fila.

- `id`, `mesocycle_id` (FK CASCADE, index), `day_number INT NOT NULL`, `name VARCHAR(40) NOT NULL`, timestamps.
- `UNIQUE(mesocycle_id, day_number)`.
- CHECK `dia_positivo`: `day_number >= 1`.
- Motivo de tabla aparte y no una columna en `mesocycle_exercises`: el nombre pertenece al día, no al ejercicio. Repetirlo en cada ejercicio invita a que dos filas del mismo día digan cosas distintas.

### Migración
- Los CHECK de las columnas **añadidas** van escritos a mano (Alembic no los detecta).
- `downgrade`: borra `mesocycle_days`, restaura el UNIQUE viejo `(mesocycle_id, position)` y quita las columnas. Tiene que correr con datos dentro; si hay más de un día, las posiciones pueden chocar al volver al UNIQUE viejo — renumera `position` por mesociclo antes de restaurarlo y documéntalo.
- Verificar en SQLite **y** PostgreSQL: `upgrade head` → `alembic check` → `downgrade -1` → `upgrade head`.
- Añadir `mesocycle_days` a `EXPECTED_TABLES` en `tests/test_schema.py`.

---

## 4. API

### Crear el mesociclo (`POST /mesocycles`)
- `MesocycleIn` gana `days_per_week: int = Field(default=1, ge=1, le=7)` y `days: list[MesocycleDayIn] = []`, donde `MesocycleDayIn` = `day_number` + `name: str = Field(min_length=1, max_length=40)`.
- `MesocycleExerciseIn` gana `day_number: int = Field(default=1, ge=1, le=7)`.
- Validaciones, todas con 422 y mensaje que diga **qué** está mal:
  - Ningún ejercicio con `day_number > days_per_week`.
  - Ningún día entre 1 y `days_per_week` puede quedarse **sin ejercicios**. Un día vacío es casi siempre un descuido, y el atleta se encontraría una sesión sin nada.
  - Ningún nombre de día con `day_number > days_per_week`.
- La regla de los básicos (carga en todas las semanas) no cambia y sigue aplicando por ejercicio, independientemente del día.

### Editar el reparto
`PUT /mesocycles/{id}/days` — el coach cambia nombres y `days_per_week`, y reasigna ejercicios a días.
- Cuerpo: `days_per_week`, `days: [{dayNumber, name}]`, `exercises: [{exerciseId, dayNumber, position}]`.
- Si al bajar `days_per_week` quedaran ejercicios huérfanos en días que ya no existen → 422 nombrándolos. **No los muevas tú en silencio.**
- Solo el coach que lleva al atleta (usa `writable_mesocycle`).

### Leer
- `MesocycleOut` devuelve `daysPerWeek` y `days: [{dayNumber, name}]`; cada ejercicio, su `dayNumber`.
- `GET /mesocycles/{id}/plan` (la tabla) agrupa por día: la salida trae los ejercicios ordenados por `(day_number, position)` y cada fila dice a qué día pertenece.

### Generar sesión (`POST /mesocycles/{id}/sessions`)
- `SessionCreate` gana `day_number: int = Field(ge=1, le=7)`.
- Selecciona **solo** los `MesocycleExercise` de ese día, ordenados por `position`.
- `day_label` se rellena solo: el nombre del día si existe, si no `"Día N"`. Se mantiene el campo por compatibilidad y se sigue aceptando un texto explícito, que gana si viene.
- Guarda `day_number` también en `training_sessions` (columna nueva `day_number INT NOT NULL DEFAULT 1`, CHECK `>= 1`): sin ella no se puede saber qué días de la semana faltan, porque `day_label` es texto libre y en los mesociclos viejos dice cualquier cosa.
- Si ese día ya tiene una sesión **sin completar** en esa semana, devuélvela en vez de crear una segunda (409 sería peor: el coach solo quiere abrirla).

### Qué toca ahora (`GET /sessions/current`)
Hoy devuelve la sesión en curso o `null`. Pasa a devolver también **qué toca si no hay ninguna abierta**:

```
{ "session": SessionOut | null,
  "next": { "weekNumber": 2, "dayNumber": 2, "dayName": "Empuje" } | null }
```

Reglas de `next`, en este orden:
1. Semana en curso = la del último día **completado**; si no hay ninguno, la 1.
2. Dentro de esa semana, el `day_number` más bajo entre 1 y `days_per_week` **sin sesión completada**.
3. Si todos los días de esa semana están completados → semana siguiente, día 1.
4. Si la semana siguiente pasa de `total_weeks` → `next: null` y el mesociclo está terminado.

Casos que hay que cubrir explícitamente, porque son los que rompen este tipo de lógica:
- Un día saltado sigue apareciendo mientras siga siendo el más bajo sin completar de su semana.
- Una sesión **abierta y sin completar** se devuelve en `session`, no se genera otra.
- Semana de deload (la última) se comporta igual que cualquier otra.

### `POST /sessions/next` — el atleta abre su día (DECIDIDO)

El dueño lo confirmó: **el atleta entra al gimnasio, abre la app y entrena, sin depender de que haya alguien disponible para generarle la sesión.**

Endpoint nuevo, separado a propósito de `create_session`:

- Solo rol **atleta**, y **solo para sí mismo**. No recibe `athlete_id`, `week_number` ni `day_number`: los tres salen de `next` calculado en el servidor. Un endpoint que aceptara esos parámetros sería un endpoint donde el atleta elige qué entrenar.
- Si `next` es `null` (mesociclo terminado) → 409 con un mensaje claro. Si ya hay una sesión abierta sin completar → la devuelve, no crea otra.
- Pasa por `active_user`, así que un atleta con la membresía vencida recibe 402 igual que en todo lo demás.
- Por dentro reutiliza exactamente la misma generación que `create_session` (motor, congelado de cargas, `policy_version`, validación de marcas para los %). **No dupliques esa lógica**: extrae la parte común a una función del servicio y que la llamen los dos endpoints. Dos copias de la generación de sesiones divergirían, y el atleta acabaría entrenando con números distintos a los que ve el coach.

**Esto no rompe la regla de que el atleta no escribe su plan.** No elige ejercicios, ni cargas, ni series, ni semana: abre el día que el coach ya dejó pautado. Escribe la fila de `training_sessions`, no el plan.

El coach **mantiene** `POST /mesocycles/{id}/sessions`: le sirve para resolver algo estando delante del atleta. Son dos puertas al mismo sitio, con permisos distintos, y por eso comparten implementación.

Tests obligatorios de este endpoint:
- Un atleta abre su día y recibe los ejercicios de ese día.
- El mismo atleta lo llama dos veces seguidas → la misma sesión, no dos.
- Un atleta con membresía vencida → 402.
- Un atleta intentando abrir con el mesociclo terminado → 409.
- Un **coach** llamando a `/sessions/next` → 403 (no es suyo ese endpoint).
- Lo generado por `/sessions/next` es idéntico, campo a campo, a lo que genera el coach para esa misma semana y día.

---

## 5. App

### `NewMesoSheet.tsx`, paso 1
- Selector de **días por semana** (1 a 7), junto al de duración.

### `NewMesoSheet.tsx`, paso 2 (elegir ejercicios)
- Cada ejercicio seleccionado muestra chips `D1 D2 D3…` (tantos como días) para asignarlo. Por defecto, el día 1.
- Arriba, un campo opcional por día para el nombre: `Día 1 · ____`.
- Aviso en rojo si algún día se queda sin ejercicios, con el botón de siguiente deshabilitado.

### Paso 3 y la tabla
- Los ejercicios se agrupan bajo un encabezado por día (`DÍA 1 · EMPUJE`), en `NewMesoSheet` y en `PlanGrid`.

### Pantalla del atleta (`app/(tabs)/index.tsx`)
- Sin sesión abierta: tarjeta con `Semana 2 · Día 2 · Empuje` y el botón de empezar.
- Mesociclo terminado: mensaje de bloque completado, sin botón.
- Sin mesociclo: lo que se muestra hoy.

### Coach (`app/(tabs)/mesos.tsx`)
- El resumen del mesociclo enseña el reparto: `3 días · D1 Empuje · D2 Pierna · D3 Tirón`.

---

## 6. Tests obligatorios

Cada uno tiene que fallar si rompes lo que prueba. Compruébalo rompiéndolo.

**Backend**
- Crear un mesociclo de 3 días reparte los ejercicios; la sesión del día 2 trae **solo** los del día 2, en su orden.
- Crear con un ejercicio en el día 4 y `daysPerWeek: 3` → 422.
- Crear con el día 2 vacío → 422 que nombre el día.
- `PUT /days` bajando de 3 a 2 con ejercicios en el día 3 → 422, sin mover nada.
- `next` con cero sesiones → semana 1, día 1.
- `next` tras completar el día 1 de la semana 1 → semana 1, día 2.
- `next` tras completar **todos** los días de la semana 1 → semana 2, día 1.
- `next` saltándose el día 2 y completando el 3 → sigue ofreciendo el día 2.
- `next` con todo el mesociclo completado → `null`.
- Una sesión abierta sin completar sale en `session`, y volver a generar ese día la devuelve en vez de duplicarla.
- `day_label` se rellena con el nombre del día, y con `"Día N"` cuando no hay nombre.
- Un mesociclo creado antes de esta migración (un día, sin nombres) sigue funcionando: la sesión trae todos sus ejercicios.
- Permisos: el coach ajeno recibe 404 en `PUT /days`; el atleta, 403.

**App**
- `npm run typecheck` limpio y `npm test` verde.

---

## 7. Cierre

```powershell
cd C:\Users\cruzm\source\the-cage\services\api
.\.venv\Scripts\ruff.exe check . ; .\.venv\Scripts\ruff.exe format --check .
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\alembic.exe upgrade head ; .\.venv\Scripts\alembic.exe check

cd C:\Users\cruzm\source\the-cage
npm test ; npm run typecheck ; npm run golden
git diff --exit-code packages/engine/golden/cases.json
```

Commitea el bloque entero de una vez. Después:

```powershell
cd services\api
fly deploy
cd ..\..\apps\mobile
npx eas-cli@latest update --branch preview --message "Bloque 7: dias de entrenamiento"
```

El motor no se toca en este bloque: los días son organización, no autorregulación. Si `npm run golden` da diff, algo se movió donde no debía.
