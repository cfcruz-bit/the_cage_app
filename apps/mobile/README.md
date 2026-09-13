# @cage/mobile

App Expo de The Cage 2.0. **Fase 1**: atleta, sesión de hoy, todo local.

## Arrancar

Desde la raíz del repo, la primera vez:

```powershell
npm install
npm install -w @cage/mobile
npx expo install --fix --prefix apps/mobile
```

Luego, cada vez:

```powershell
npm run mobile
```

Escanea el QR con **Expo Go** en tu teléfono, o pulsa `a` para Android / `i` para iOS.

## Qué hay

| Pantalla | Estado |
|---|---|
| Sesión de hoy | Tabla de sets (variante A), motor en vivo, registro persistente |
| Feedback | Las 4 preguntas + preview real de la próxima semana |
| Mesociclo | Proyección semanal por ejercicio, deload al cierre |
| Ejercicios | Biblioteca con filtro y buscador |
| Ajustes | Unidad y agresividad, aplicados de verdad |

## Decisiones de esta fase

- **Solo la variante A** de la pantalla de sesión. B y C quedan fuera del MVP:
  mantener las tres triplica el coste de la pantalla más compleja de la app.
- **Solo el rol Atleta.** Coach llega en la Fase 3, cuando el rol lo decide el
  servidor y no un `setState`.
- **expo-sqlite a pelo, sin ORM.** El esquema imita al de Postgres para que
  migrar sea traducir. `sync_queue` ya existe aunque nadie la vacíe todavía.
- **Sin librería de bottom sheets.** El `Modal` nativo basta y no se rompe al
  subir de SDK.
- **Iconos Ionicons** en lugar de Phosphor: vienen con Expo y evitan cargar una
  fuente de 2 MB. El set de Phosphor del prototipo se recupera si hace falta.

## Estructura

```
app/                 Rutas (expo-router)
  (tabs)/            Las 4 pestañas del atleta
src/theme/           Tokens Nocturne — ninguna pantalla escribe un hex
src/lib/units.ts     Única frontera kg ↔ lb
src/db/              SQLite: esquema, migraciones, lectura y escritura
src/stores/          session (dominio) y ui (interfaz) — separados a propósito
src/features/        workout y feedback
```

## Reglas

- El motor se llama **por ejercicio**, dentro de `useMemo`. Registrar un set del
  ejercicio 1 no replantea el ejercicio 3.
- Los componentes se suscriben con **selectores finos**, nunca al store entero.
- Todo lo que entra al store se escribe además en SQLite en la misma acción.
- Un input inválido **no se guarda y se avisa**; nunca se convierte en 0.
