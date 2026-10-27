/**
 * Una fila de set, desde el lado del atleta.
 *
 * El atleta NO edita la prescripción: lee el objetivo que puso su coach y lo
 * marca como hecho. Si no le salió —se quedó corto de reps, cambió el peso—
 * abre el reporte de desviación desde el ⋮ y cuenta qué pasó. Ese reporte es lo
 * único que llega al motor, y solo cuando hubo diferencia.
 *
 * Se pinta como una fila de tabla: ⋮ · peso · reps · resultado · check. Las
 * columnas las fija la cabecera de SessionExerciseCard; si cambias un ancho
 * aquí, cámbialo allí.
 *
 * Es el componente más caliente de la app: va memoizado y solo recibe
 * primitivos y callbacks estables.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, palette, radius, space } from '@/theme/tokens';
import { Unit, formatNumber } from '@/lib/units';

interface Props {
  index: number;
  unit: Unit;
  /**
   * Lo que manda el plan. null cuando el ejercicio no tiene ningún peso
   * todavía: no hay objetivo que proponer, el atleta registra el suyo.
   */
  targetWeightKg: number | null;
  targetReps: number | null;
  why: string;
  /** Lo que el atleta reportó, si reportó algo distinto. */
  loggedWeightKg: number | null;
  loggedReps: string | null;
  done: boolean;
  /** Es el próximo set pendiente de toda la sesión. */
  isNext: boolean;
  /** Solo cuando el ejercicio lleva back-off: distingue el top de los back-offs. */
  kind?: 'top' | 'backoff';

  onToggle: () => void;
  onReport: () => void;
}

/** Anchos de las columnas fijas. La cabecera de la tabla usa los mismos. */
export const SET_COLUMNS = { menu: 34, result: 34, check: 48 } as const;

export const SetRow = memo(function SetRow({
  index,
  unit,
  targetWeightKg,
  targetReps,
  why,
  loggedWeightKg,
  loggedReps,
  done,
  isNext,
  kind,
  onToggle,
  onReport,
}: Props) {
  const hasTarget = targetWeightKg !== null && targetReps !== null;
  const loggedRepsN = loggedReps == null ? null : parseInt(loggedReps, 10);
  const weightChanged =
    hasTarget && done && loggedWeightKg != null && Math.abs(loggedWeightKg - targetWeightKg) > 0.01;
  const repsChanged = hasTarget && done && loggedRepsN != null && loggedRepsN !== targetReps;
  const deviated = weightChanged || repsChanged;

  const shownWeight = loggedWeightKg ?? targetWeightKg;
  const shownReps = loggedRepsN ?? targetReps;
  // Más tonelaje que el pautado cuenta como "por encima", aunque baje una de las dos.
  const above =
    deviated && (shownWeight ?? 0) * (shownReps ?? 0) > targetWeightKg * targetReps;
  // En la tabla, la explicación del set solo acompaña al que toca: en todas las
  // filas pendientes tapaba los números.
  const note = done ? null : !hasTarget ? 'Registra tu peso con el check.' : isNext ? why : null;

  return (
    <View style={[styles.row, isNext && styles.rowNext]}>
      <View style={styles.cols}>
        <Pressable
          onPress={onReport}
          accessibilityRole="button"
          accessibilityLabel={
            done ? `Corregir el set ${index + 1}` : `No pude con el set ${index + 1}`
          }
          hitSlop={{ top: 8, bottom: 8, left: 8 }}
          style={({ pressed }) => [styles.menu, pressed && styles.pressed]}
        >
          <Ionicons name="ellipsis-vertical" size={16} color={color.textFaint} />
        </Pressable>

        <View style={styles.cell}>
          {kind !== undefined ? (
            <Text style={styles.kind}>{kind === 'top' ? 'TOP' : 'B-O'}</Text>
          ) : null}
          <Text style={[styles.value, done && styles.valueDone, weightChanged && styles.valueChanged]}>
            {shownWeight === null ? '—' : formatNumber(shownWeight, unit)}
          </Text>
          {weightChanged ? (
            <Text style={styles.was}>{formatNumber(targetWeightKg, unit)}</Text>
          ) : null}
        </View>

        <View style={styles.cell}>
          <Text style={[styles.value, done && styles.valueDone, repsChanged && styles.valueChanged]}>
            {shownReps ?? '—'}
          </Text>
          {repsChanged ? <Text style={styles.was}>{targetReps}</Text> : null}
        </View>

        <View
          style={styles.result}
          accessible={done}
          accessibilityLabel={
            deviated ? 'Reportado, el motor lo tendrá en cuenta' : 'Objetivo cumplido'
          }
        >
          {done && hasTarget ? (
            <Ionicons
              name={deviated ? (above ? 'trending-up' : 'trending-down') : 'radio-button-on-outline'}
              size={deviated ? 18 : 19}
              color={deviated ? (above ? palette.a300 : color.accent) : color.textFaint}
            />
          ) : null}
        </View>

        <Pressable
          onPress={hasTarget ? onToggle : onReport}
          accessibilityRole="checkbox"
          accessibilityLabel={
            hasTarget
              ? done
                ? `Desmarcar set ${index + 1}`
                : `Marcar set ${index + 1} como hecho`
              : `Registrar el set ${index + 1}`
          }
          accessibilityState={{ checked: done }}
          hitSlop={8}
          style={({ pressed }) => [
            styles.check,
            done ? styles.checkDone : isNext ? styles.checkNext : styles.checkPending,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={done ? 'checkmark' : 'ellipse-outline'}
            size={done ? 19 : 15}
            color={done ? color.onBone : color.textFaint}
          />
        </Pressable>
      </View>

      {note ? (
        <Text style={styles.why} numberOfLines={2}>
          {note}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    justifyContent: 'center',
    paddingVertical: space.xs,
    paddingLeft: space.xs,
    paddingRight: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  rowNext: { backgroundColor: color.rowHighlight },
  cols: { flexDirection: 'row', alignItems: 'center' },
  menu: {
    width: SET_COLUMNS.menu,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cell: { flex: 1, alignItems: 'center' },
  kind: { color: color.accent, fontSize: 10, fontWeight: '500', letterSpacing: 1.6 },
  value: {
    color: color.text,
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  valueDone: { color: color.textMuted },
  valueChanged: { color: palette.a300 },
  was: {
    color: color.textFaint,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    textDecorationLine: 'line-through',
  },
  result: { width: SET_COLUMNS.result, alignItems: 'center' },
  check: {
    width: SET_COLUMNS.check,
    height: SET_COLUMNS.check,
    borderRadius: radius.chip,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: color.bone, borderColor: color.bone },
  checkPending: { backgroundColor: 'transparent', borderColor: color.border },
  checkNext: { backgroundColor: 'transparent', borderColor: color.accent },
  pressed: { opacity: 0.6 },
  why: {
    color: color.textMuted,
    fontSize: 12,
    marginLeft: SET_COLUMNS.menu,
    paddingBottom: space.sm,
  },
});
