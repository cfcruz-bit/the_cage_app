# The Cage 2.0

App de entrenamiento con autorregulación. Atleta y Coach.

Ubicación: `C:\Users\cruzm\source\the-cage` — **fuera de OneDrive**, a propósito:
`node_modules` son decenas de miles de archivos y sincronizarlos rompe la máquina.

## Estructura

```
packages/engine/   Motor de autorregulación (TypeScript, puro, testeado)  ✅ Fase 0
apps/mobile/       App Expo / React Native, todo local                    ✅ Fase 1
services/api/      Backend FastAPI + PostgreSQL                           ⬜ Fase 2
```

Es un monorepo con workspaces de npm: **un solo `npm install` en la raíz**
instala el motor y la app.

## Cómo ejecutarlo tú, en Windows

Necesitas **Node.js 20 o superior**. Comprueba en PowerShell:

```powershell
node -v
npm -v
```

Si falta, instálalo desde https://nodejs.org (versión LTS) o con
`winget install OpenJS.NodeJS.LTS`, y cierra y reabre la terminal.

**La primera vez**, borra `node_modules` y reinstala. Las dependencias que hay
ahora se instalaron desde Linux y traen binarios que Windows no puede ejecutar
(esbuild, rollup):

```powershell
cd "C:\Users\cruzm\source\the-cage\packages\engine"
Remove-Item -Recurse -Force node_modules
npm install
```

**La app en tu teléfono:**

```powershell
cd "C:\Users\cruzm\source\the-cage"
npm run mobile
```

Escanea el QR con **Expo Go**. Todo funciona en modo avión: lo que registres se
guarda en SQLite dentro del teléfono.

**A partir de ahí**, el día a día:

```powershell
npm test          # los 1 805 tests
npm run typecheck # TypeScript sin compilar
npm run test:watch # reejecuta al guardar — el modo útil mientras programas
npm run golden    # regenera golden/cases.json (solo al cambiar una regla)
```

En VS Code: abre la carpeta `the-cage` (no `packages/engine`), y la terminal
integrada con `Ctrl+ñ`. Todo lo de arriba funciona igual ahí.

## Estado

| Fase | Qué | Estado |
|---|---|---|
| 0 | Rescatar el motor del prototipo HTML | **Hecha** — 1 805 tests verdes, 0 discrepancias contra el prototipo |
| 1 | App Expo con SQLite local, sin backend | **Hecha** — falta probarla en un teléfono |
| 2 | Backend FastAPI, motor portado a Python | Pendiente |
| 3 | Sincronización offline-first, coach, alertas, CI | Pendiente |

## Reglas de la casa

- **Todo en kilogramos.** El motor y la base guardan kg. Las libras son
  presentación y se convierten al renderizar, nunca antes.
- **El servidor manda.** Si el cálculo local y el del servidor difieren, gana el
  del servidor.
- **Cambiar una regla es cambiar `POLICY_VERSION`** y regenerar
  `packages/engine/golden/cases.json` en el mismo PR.
- **Nada de secretos en el repo.** `.env` está ignorado desde el primer commit.

Documentación técnica: `packages/engine/docs/`
