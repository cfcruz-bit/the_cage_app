/**
 * El set que toca ahora, a tamaño de leerse con el móvil en el suelo.
 *
 * Es lo único que el atleta necesita entre series: qué carga, cuántas reps y
 * un botón grande. La lista de tarjetas de abajo sigue ahí para corregir un set
 * ya hecho o dar feedback.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LoadedBar } from './LoadedBar';
import { type Unit, formatNumber } from '@/lib/units';
import type { WarmupSet } from '@/lib/warmup';
import { color, condensed, radius, space } from '@/theme/tokens';

interface Props {
  exerciseName: string;
  setNumber: number;
  setCount: number;
  unit: Unit;
  /** null cuando el ejercicio no tiene peso todavía: el atleta registra el suyo. */
  targetWeightKg: number | null;
  targetReps: number | null;
  why: string;
  /** Reps a dejar en reserva esta semana. null si la sesión no lo trae. */
  rir: number | null;
  /** El ejercicio se hace con barra: tiene sentido dibujar los discos. */
  barbell: boolean;
  /**
   * Aproximaciones antes del primer set, y cuántas lleva hechas. Mientras
   * falte alguna, el bloque enseña esa en vez del set de trabajo. No se guardan
   * en ningún sitio: no son trabajo que el motor tenga que contar.
   */
  warmup?: { sets: WarmupSet[]; done: number; onChange: (done: number) => void };
  onDone: () => void;
  onReport: () => void;
}

export function FocusSet({
  exerciseName,
  setNumber,
  setCount,
  unit,
  targetWeightKg,
  targetReps,
  why,
  rir,
  barbell,
  warmup,
  onDone,
  onReport,
}: Props) {
  const hasTarget = targetWeightKg !== null && targetReps !== null;
  const warm = warmup !== undefined ? warmup.sets[warmup.done] : undefined;

  if (warmup !== undefined && warm !== undefined) {
    return (
      <View style={styles.block}>
        <View style={styles.head}>
          <Text style={styles.name} numberOfLines={1}>
            {exerciseName}
          </Text>
          <Text style={styles.setN}>
            Calentamiento {warmup.done + 1} de {warmup.sets.length}
          </Text>
        </View>

        <View style={styles.warmStrip}>
          {warmup.sets.map((w, i) => {
            const done = i < warmup.done;
            return (
              <Pressable
                key={i}
                onPress={() => warmup.onChange(done ? i : i + 1)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={`Aproximación ${formatNumber(w.kg, unit)} por ${w.reps}`}
                style={({ pressed }) => [
                  styles.warmChip,
                  done && styles.warmChipDone,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.warmText, done && styles.warmTextDone]}>
                  {i === 0 ? 'Barra' : formatNumber(w.kg, unit)} × {w.reps}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.load}>
          <Text style={styles.num}>{formatNumber(warm.kg, unit)}</Text>
          <Text style={styles.unit}>
            {unit} × {warm.reps}
          </Text>
          <Text style={styles.rir}>aproximación</Text>
        </View>

        {unit === 'kg' ? <LoadedBar kg={warm.kg} /> : null}

        <View style={styles.actions}>
          <Pressable
            onPress={() => warmup.onChange(warmup.done + 1)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.done, pressed && styles.pressed]}
          >
            <Text style={styles.doneText}>Calentamiento hecho</Text>
          </Pressable>
          <Pressable
            onPress={() => warmup.onChange(warmup.sets.length)}
            accessibilityRole="button"
            accessibilityLabel="Saltar el calentamiento"
            style={({ pressed }) => [styles.cant, pressed && styles.pressed]}
          >
            <Text style={styles.cantText}>Saltar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>
          {exerciseName}
        </Text>
        <Text style={styles.setN}>
          Set {setNumber} de {setCount}
        </Text>
      </View>

      {hasTarget ? (
        <View style={styles.load}>
          <Text style={styles.num}>{formatNumber(targetWeightKg, unit)}</Text>
          <Text style={styles.unit}>
            {unit} × {targetReps}
          </Text>
          {rir !== null ? <Text style={styles.rir}>deja {rir} en reserva</Text> : null}
        </View>
      ) : (
        <Text style={styles.noTarget}>Sin carga pautada todavía</Text>
      )}

      {hasTarget && barbell && unit === 'kg' ? <LoadedBar kg={targetWeightKg} /> : null}

      {why ? (
        <Text style={styles.why} numberOfLines={1}>
          {why}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={hasTarget ? onDone : onReport}
          accessibilityRole="button"
          accessibilityLabel={
            hasTarget ? `Marcar set ${setNumber} como hecho` : `Registrar el set ${setNumber}`
          }
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}
        >
          <Text style={styles.doneText}>{hasTarget ? 'Hecho' : 'Registrar set'}</Text>
        </Pressable>

        {hasTarget ? (
          <Pressable
            onPress={onReport}
            accessibilityRole="button"
            accessibilityLabel={`No pude con el set ${setNumber}`}
            style={({ pressed }) => [styles.cant, pressed && styles.pressed]}
          >
            <Text style={styles.cantText}>No pude</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: color.slam,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  name: { flex: 1, color: color.bone, fontSize: 17, fontWeight: '600' },
  setN: { color: color.bone, opacity: 0.8, fontSize: 13 },
  load: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  num: {
    ...condensed,
    color: color.bone,
    fontSize: 64,
    lineHeight: 64,
    fontVariant: ['tabular-nums'],
  },
  unit: { ...condensed, color: color.bone, fontSize: 24 },
  rir: { marginLeft: 'auto', color: color.bone, opacity: 0.85, fontSize: 13 },
  noTarget: { color: color.bone, fontSize: 20, fontWeight: '600' },
  why: { color: color.bone, opacity: 0.85, fontSize: 13.5, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  done: {
    flex: 1,
    backgroundColor: color.bone,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: radius.chip,
  },
  doneText: { ...condensed, color: color.onBone, fontSize: 22, letterSpacing: 0.5 },
  cant: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.md },
  cantText: { color: color.bone, fontSize: 14 },
  pressed: { opacity: 0.7 },
  warmStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  warmChip: {
    minHeight: 36,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.boneEdge,
    borderRadius: radius.chip,
  },
  warmChipDone: { backgroundColor: color.bone, borderColor: color.bone },
  warmText: { color: color.bone, fontSize: 13.5, fontVariant: ['tabular-nums'] },
  warmTextDone: { color: color.onBone },
});
