# @cage/engine

Motor de autorregulación de **The Cage 2.0**, rescatado del prototipo HTML y
convertido en una librería pura, tipada y cubierta por tests.

Es la **Fase 0** de la hoja de ruta: lo único del prototipo que se porta línea
por línea, porque es lo único que no se puede volver a deducir mirando una
captura de pantalla.

```bash
npm install
npm test          # 1 805 tests
npm run typecheck
npm run golden    # regenera el contrato TS ↔ Python
```

---

## Qué hace

Dado lo que un atleta hizo la última vez en un ejercicio y cómo se sintió,
decide **qué carga y cuántos hard sets** le tocan hoy, y **por qué**.

```ts
import { Aggressiveness, fixture, planExercise, planSets } from '@cage/engine';

const ex = fixture('ex-cuffed-lateral-raise');
const plan = planExercise(ex, Aggressiveness.Medium);

plan.loadKg;   // 27.5   (subió 2.5 kg)
plan.sets;     // 4      (uno más que la semana pasada)
plan.setNote;  // '+1 set'
plan.why;      // 'llegaste al tope de 15 reps'
plan.addReason // 'reportaste volumen insuficiente'

const sets = planSets(ex, plan, []);
sets[3].why;   // 'set añadido: reportaste volumen insuficiente'
```

Y recalcula dentro de la sesión con lo que el atleta ya registró:

```ts
// El primer set se le quedó corto: 4 reps con un rango de 10–15
const conRegistro = planSets(ex, plan, [{ weightKg: 27.5, reps: '4', done: true }]);
conRegistro[1].targetWeightKg; // 25
conRegistro[1].why;            // 'back-off: el set previo cayó bajo 10 reps'
```

---

## Reglas implementadas

**Entre semanas** (`planExercise`)

1. Cada RIR de holgura sobre el objetivo suma un escalón de carga.
2. Llegar al tope del rango de reps suma otro escalón.
3. Pasarse del RIR objetivo sostiene la carga.
4. Volumen insuficiente (o, en su defecto, pump bajo) añade un hard set.
5. Volumen "Al límite" limita la subida a un solo escalón.
6. Volumen "Demasiado" quita un hard set, con suelo de 2.
7. Dolor articular severo recorta la carga al 95% y quita un set — **sobrescribe
   todo lo anterior**.
8. Soreness persistente congela la carga — también sobrescribe.

**Dentro de la sesión** (`planSets`)

- Set previo por debajo del rango → back-off de un incremento.
- Set previo por encima del rango → sube un incremento.
- Set previo dentro del rango → misma carga, una rep menos por fatiga.
- Set previo sin registrar → se asume caída de ~1 rep.

Cada decisión devuelve una frase en español que viaja hasta la pantalla. Eso es
producto, no logging: es lo que separa esto de una libreta de notas.

---

## Estructura

```
src/
  types.ts           Tipos del dominio y enums de feedback
  policy.ts          Todas las constantes con nombre + POLICY_VERSION
  math.ts            clamp, roundTo, e1rm (Epley + RIR)
  autoregulation.ts  planExercise, planSets        ← el port literal
  projection.ts      projectMesocycle
  fixtures.ts        Los 3 ejercicios del prototipo, anclando los tests
test/
  autoregulation.spec.ts   23 tests, una rama cada uno
  plan-sets.spec.ts        16 tests de reacción dentro de la sesión
  golden.spec.ts           1 764 casos de regresión
golden/
  cases.json         Contrato ejecutable TS ↔ Python (ver docs/)
docs/
  engine-contract.md Cómo portar a Python sin que las dos diverjan
  screens.md         Inventario de las 10 pantallas del prototipo
  design-tokens.json Paleta Nocturne, tipografía, espaciado
```

---

## Reglas de la casa

**Todo en kilogramos.** El motor y la persistencia trabajan siempre en kg. Las
libras son una preferencia de render y se convierten al pintar, nunca antes.
Esto ya estaba bien resuelto en el prototipo y es la clase de invariante que se
rompe en un descuido y corrompe años de histórico.

**Las funciones son puras.** Nada aquí lee estado global, toca red o formatea
unidades. Es lo que permite ejecutar el mismo código en el teléfono y en el
servidor.

**Las constantes viven en `policy.ts`.** Cambiar un número de ahí cambia los
entrenamientos de todos los atletas: sube `POLICY_VERSION` y guárdala junto a
cada plan generado, para poder leer el histórico sabiendo con qué reglas se
produjo.

**Los casos golden no se editan a mano.** Se regeneran con `npm run golden`, y
solo cuando una regla cambia a propósito. Un diff inesperado en ese archivo es
una alarma, no un conflicto que resolver.

---

## Lo que este paquete no hace

- No conoce usuarios, mesociclos ni sesiones: eso es la capa de servicios.
- No genera mesociclos nuevos desde cero (Fase 2).
- No implementa Myorep ni Myorep Match: aparecen en el menú del prototipo pero
  no tienen lógica. Hay que definirlos en el dominio antes de dibujarlos, porque
  cambian la forma de `set_logs`.
- No calcula las alertas del coach: son tres reglas escritas a mano en el
  prototipo y se implementan en la Fase 3.

---

## Criterio de salida de la Fase 0

- [x] Motor portado sin cambiar una sola regla
- [x] Constantes extraídas y versionadas
- [x] Tests por rama, verdes
- [x] Casos golden generados como contrato para Python
- [x] Pantallas y tokens documentados
- [ ] Verificado contra el prototipo abierto al lado (hazlo tú: abre el HTML,
      marca un feedback y compara los números con `npm test`)
