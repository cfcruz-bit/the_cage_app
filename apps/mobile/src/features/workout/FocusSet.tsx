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
  /** El ejercicio se hace con barra: tiene sentido dibujar los discos. */
  barbell: boolean;
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
  barbell,
  onDone,
  onReport,
}: Props) {
  const hasTarget = targetWeightKg !== null && targetReps !== null;

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
});
