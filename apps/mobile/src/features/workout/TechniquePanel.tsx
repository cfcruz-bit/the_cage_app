/**
 * El último set cuando lleva técnica: se registra parte a parte.
 *
 * Se abre debajo de la fila en vez de en una hoja, porque el atleta lo rellena
 * con el peso en la mano y entre partes no hay tiempo para navegar.
 *
 * - Drop set: todas las bajadas a la vista con su peso ya calculado.
 * - Rest-pause: cada mini-serie se desbloquea al acabar la pausa, que corre
 *   aquí mismo. Se puede saltar: el reloj ayuda, no manda.
 * - Myo-reps: todas a la vista; la pausa son unas respiraciones, sin reloj.
 *
 * Lo que guarda es una lista de reps por parte. La primera es la que lee el
 * motor; el resto viaja aparte, en `subSets`.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type TechniquePlan, dropWeights, partCount } from '@/lib/technique';
import { type Unit, formatNumber } from '@/lib/units';
import { color, condensed, radius, space } from '@/theme/tokens';

interface Props {
  plan: TechniquePlan;
  weightKg: number;
  incrementKg: number;
  targetReps: number;
  unit: Unit;
  onSave: (parts: number[]) => void;
}

/** Reps con las que arranca cada parte: el atleta solo corrige. */
function seed(plan: TechniquePlan, targetReps: number): number[] {
  const rest =
    plan.technique === 'myo_reps'
      ? plan.amount
      : Math.max(1, Math.round(targetReps / (plan.technique === 'drop_set' ? 2 : 3)));
  return [targetReps, ...Array<number>(plan.rounds).fill(rest)];
}

export function TechniquePanel({ plan, weightKg, incrementKg, targetReps, unit, onSave }: Props) {
  const [parts, setParts] = useState(() => seed(plan, targetReps));
  // Rest-pause: hasta qué parte está desbloqueada y cuánto queda de pausa.
  const [phase, setPhase] = useState(0);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const total = partCount(plan);
  const gated = plan.technique === 'rest_pause';
  const weights =
    plan.technique === 'drop_set'
      ? dropWeights(weightKg, plan.rounds, plan.amount, incrementKg)
      : Array<number>(total).fill(weightKg);
  const ready = !gated || (phase === total - 1 && left === 0);

  const title =
    plan.technique === 'drop_set'
      ? ['Drop set', 'sin descanso entre bajadas']
      : plan.technique === 'rest_pause'
        ? ['Rest-pause', `${plan.amount} s entre partes`]
        : ['Myo-reps', '3–5 respiraciones entre partes'];

  function bump(i: number, delta: number) {
    setParts((p) => p.map((n, k) => (k === i ? Math.max(0, Math.min(100, n + delta)) : n)));
  }

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>{title[0]}</Text>
        <Text style={styles.meta}>{title[1]}</Text>
      </View>

      {parts.map((reps, i) => {
        const locked = gated && (i > phase || (i === phase && left > 0));
        return (
          <View key={i}>
            <View style={[styles.row, i > 0 && styles.rowRule, locked && styles.locked]}>
              <View style={styles.label}>
                <Text style={styles.labelMain}>
                  {plan.technique === 'drop_set'
                    ? `${formatNumber(weights[i] ?? weightKg, unit)} ${unit}`
                    : i === 0
                      ? 'Primera parte'
                      : `Mini-serie ${i}`}
                </Text>
                <Text style={styles.meta}>
                  {plan.technique === 'drop_set'
                    ? i === 0
                      ? 'set de trabajo'
                      : `bajada ${i}`
                    : `${formatNumber(weights[i] ?? weightKg, unit)} ${unit}`}
                </Text>
              </View>
              {locked ? (
                <Text style={styles.dash}>—</Text>
              ) : (
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => bump(i, -1)}
                    accessibilityRole="button"
                    accessibilityLabel="Una repetición menos"
                    style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                  >
                    <Text style={styles.stepText}>−</Text>
                  </Pressable>
                  <Text style={styles.reps} accessibilityLabel={`${reps} repeticiones`}>
                    {reps}
                  </Text>
                  <Pressable
                    onPress={() => bump(i, 1)}
                    accessibilityRole="button"
                    accessibilityLabel="Una repetición más"
                    style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                  >
                    <Text style={styles.stepText}>+</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {gated && i === phase && left > 0 ? (
              <View style={styles.pause}>
                <Text style={styles.pauseNum}>{left}</Text>
                <Text style={styles.pauseText}>
                  Pausa. Respira y vuelve con el mismo peso.
                </Text>
                <Pressable
                  onPress={() => setLeft(0)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
                >
                  <Text style={styles.skipText}>Saltar</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {ready ? (
        <Pressable
          onPress={() => onSave(parts)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.save, pressed && styles.pressed]}
        >
          <Text style={styles.saveText}>Guardar {parts.join('+')}</Text>
        </Pressable>
      ) : left === 0 ? (
        <Pressable
          onPress={() => {
            setPhase((p) => p + 1);
            setLeft(plan.amount);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.save, pressed && styles.pressed]}
        >
          <Text style={styles.saveText}>Empezar pausa de {plan.amount} s</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginLeft: 38,
    marginRight: space.md,
    marginBottom: space.md,
    padding: space.md,
    gap: space.xs,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    backgroundColor: color.bgRaised,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  title: { color: color.text, fontSize: 14, fontWeight: '600' },
  meta: { color: color.textMuted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  locked: { opacity: 0.45 },
  label: { flex: 1, gap: 1 },
  labelMain: { color: color.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  dash: { color: color.textFaint, fontSize: 16, paddingHorizontal: space.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  step: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    backgroundColor: color.bgSunken,
  },
  stepText: { color: color.text, fontSize: 20 },
  reps: {
    ...condensed,
    minWidth: 36,
    textAlign: 'center',
    color: color.text,
    fontSize: 24,
    fontVariant: ['tabular-nums'],
  },
  pause: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    marginVertical: space.xs,
    borderRadius: radius.chip,
    backgroundColor: color.slam,
  },
  pauseNum: { ...condensed, color: color.bone, fontSize: 40, lineHeight: 42, fontVariant: ['tabular-nums'] },
  pauseText: { flex: 1, color: color.bone, fontSize: 13, lineHeight: 17 },
  skip: {
    paddingHorizontal: space.md,
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.bone,
    borderRadius: radius.chip,
  },
  skipText: { color: color.bone, fontSize: 13 },
  save: {
    marginTop: space.xs,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
    backgroundColor: color.done,
  },
  saveText: { ...condensed, color: color.onDone, fontSize: 20, letterSpacing: 0.5 },
  pressed: { opacity: 0.7 },
});
