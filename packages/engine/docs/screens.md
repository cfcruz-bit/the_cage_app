# Inventario de pantallas — The Cage 2.0

Especificación extraída del prototipo `The Cage 2.0 - App.html`. A partir de este
documento, el HTML de 6 MB queda archivado: es la referencia visual, no código
fuente. Cada pantalla lista su estado, sus datos y las decisiones pendientes.

Nomenclatura: `state.*` son campos del objeto de estado único del prototipo;
en la app pasan a los stores indicados en la columna de destino.

---

## 0. Selección de rol (`screen: 'login'`)

Dos tarjetas grandes — Atleta y Coach — con animación de entrada escalonada
(0.72 s y 0.82 s) y una transición de 300 ms al pulsar, con etiqueta a pantalla
completa (`ATLETA` / `COACH`) que se retira a los 760 ms.

| Aspecto | Prototipo | Destino |
|---|---|---|
| Elección de rol | `setState({ mode })` | Viene de `GET /me`. No es una pantalla de elección, es consecuencia del login |
| Autenticación | No existe | Email + contraseña, token en `expo-secure-store` |

**Decisión pendiente:** un usuario puede ser atleta *y* coach del mismo gimnasio.
Si se admite, esta pantalla sobrevive como selector de contexto tras el login.

---

## 1. Sesión de hoy — Atleta (`tab: 'workout'`)

La pantalla central del producto. Tiene **tres variantes** que en el prototipo se
eligen con un selector (`state.variant`):

- **A · Tabla de sets** — todos los ejercicios expandidos, una fila por set con
  peso, reps, RPE y chip de estado. Es la más densa y la más completa.
- **B · Set activo** — una sola tarjeta grande con el siguiente set pendiente,
  botones ± para la carga y el "porqué" del motor bajo el número.
- **C · Timeline** — los ejercicios en vertical con el progreso como raíl.

Datos por ejercicio: músculo, nombre, equipamiento, rango objetivo
(`repLo–repHi · RIR n`), nota de autoajuste (`+2.5 kg`, `mantener`, `+1 set`),
y por set: carga sugerida, reps sugeridas, explicación, porcentaje sobre e1RM.

| Aspecto | Prototipo | Destino |
|---|---|---|
| Cálculo | `planExercise` + `planSets` en el render | `@cage/engine` desde el store, y `GET /sessions/today` como verdad |
| Registro | `state.logs[ei][si]` en memoria | SQLite + cola de sincronización |
| Entrada numérica | `parseFloat(v) \|\| 0` | Validación en el borde, teclado numérico, sin ceros silenciosos |

**Decisión pendiente:** elegir **una** variante para el MVP. Mantener las tres
triplica el coste de la pantalla más compleja de la app.

---

## 2. Feedback del ejercicio (bottom sheet)

Cuatro preguntas, una por eje: dolor articular, soreness, pump y volumen
(hard sets). Cada una con 3–4 opciones en chips.

Lo que la hace valiosa: **debajo hay un preview en vivo** que recalcula con
`planExercise(ex, aggr, feedbackMarcado)` y dice en una frase qué pasará la
semana que viene — carga, sets y motivo, más el e1RM proyectado.

| Aspecto | Prototipo | Destino |
|---|---|---|
| Preview | Recalculado en el render | `planExercise` con `feedbackOverride` desde el store |
| Persistencia | `state.fbDone[ei] = true` | `POST /session-exercises/{id}/feedback` |

Es la pantalla que mejor vende el producto. No dejarla para el final.

---

## 3. Mesociclo (`tab: 'mesos'`)

Gráfico de barras de volumen semanal (7 semanas, la última deload) y, debajo,
una tabla de progresión por ejercicio: semana, sets, esquema de reps,
porcentaje sobre e1RM, carga y RPE objetivo, con un punto de color por RIR.

Portado a `projectMesocycle()`; los colores del punto se quedan en la UI.

---

## 4. Ejercicios (`tab: 'exercises'`)

Biblioteca con filtro por músculo (`Todos`, `Pecho`, `Espalda`, `Hombros`,
`Piernas`, `Brazos`) y buscador de texto sobre nombre + material. Cada fila
muestra el mejor registro histórico.

| Aspecto | Prototipo | Destino |
|---|---|---|
| Catálogo | Array `LIB` de 10 ejercicios | `GET /exercises`, paginado, catálogo global + propios |
| Buscador | Filtra en cada tecla sobre todo el view-model | `useDeferredValue` + índice local en SQLite |
| Imágenes | `image-slot` vacíos | Pendiente: S3 + CDN + `expo-image` |

---

## 5. Ajustes (`tab: 'more'`)

Unidades (kg/lb), agresividad del autoajuste (Baja/Media/Alta), descanso por
defecto, recordatorios y exportar historial (CSV). En el prototipo son valores
de solo lectura; en la app son el `PATCH /me` y disparan un replanteo.

---

## 6. Clientes — Coach (`tab: 'clients'`)

Tres métricas de cabecera (adherencia, sesiones/semana, alertas) y la lista de
clientes con inicial, mesociclo en curso, adherencia y barra de progreso.
Los clientes con alerta se marcan en acento.

---

## 7. Detalle de cliente — Coach

Tira de semanas del mesociclo con el estado de cada una, tarjeta de alerta con
el texto de la sugerencia, y las últimas sesiones con su pastilla de estado
(`Completa`, `Al límite`, `Parcial`, `Perdida`).

Las tres alertas del prototipo están escritas a mano en `CLIENTS[].alertText` y
son, en realidad, tres reglas:

1. RIR 0 en tres sesiones seguidas del mismo grupo muscular → quitar un hard set.
2. Dolor articular moderado dos semanas seguidas en el mismo ejercicio → sustituirlo.
3. e1RM plano tres semanas → deload del 12%.

En la Fase 3 se convierten en `app/workers/alerts.py`.

---

## 8. Menú de set (bottom sheet)

Acciones: añadir set abajo, skip set, eliminar set. Y tipo de set: Regular,
Myorep, Myorep Match.

**Decisión pendiente:** Myorep y Myorep Match aparecen en el menú pero no están
implementados. Definirlos en el dominio **antes** de dibujarlos: cambian la
forma de `set_logs` porque introducen mini-sets anidados.

---

## 9. Nuevo mesociclo (bottom sheet)

Duración (4/5/6/8 semanas), objetivo (Hipertrofia/Fuerza/Híbrido) y volumen
inicial por grupo muscular con ± en pasos de 2 sets, con total semanal.
Cierra con una frase que describe la progresión que se va a generar.

---

## Marcos de dispositivo

El prototipo envuelve todo en frames iOS/Android simulados (`IOSDevice`,
`AndroidDevice`) con status bar y teclado dibujados. **No se portan**: en Expo
esas son las barras reales del sistema.
