/**
 * Una fila de set, desde el lado del atleta.
 *
 * El atleta NO edita la prescripción: lee el objetivo que puso su coach y lo
 * marca como hecho. Si no le salió —se quedó corto de reps, cambió el peso—
 * abre el reporte de desviación y cuenta qué pasó. Ese reporte es lo único que
 * llega al motor, y solo cuando hubo diferencia.
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
  const deviated =
    hasTarget &&
    done &&
    ((loggedWeightKg != null && Math.abs(loggedWeightKg - targetWeightKg) > 0.01) ||
      (loggedRepsN != null && loggedRepsN !== targetReps));

  return (
    <View style={[styles.row, isNext && styles.rowNext]}>
      <View style={styles.head}>
        <View style={[styles.indexBox, kind !== undefined && styles.indexBoxTagged]}>
          <Text style={styles.index}>{index + 1}</Text>
          {kind !== undefined ? (
            <Text style={styles.kind}>{kind === 'top' ? 'TOP' : 'B-O'}</Text>
          ) : null}
        </View>

        <View style={styles.target}>
          {hasTarget ? (
            <>
              <Text style={[styles.prescription, done && !deviated && styles.prescriptionDone]}>
                {formatNumber(targetWeightKg, unit)} {unit} × {targetReps}
              </Text>
              {deviated ? (
                <Text style={styles.actual}>
                  hiciste {formatNumber(loggedWeightKg ?? targetWeightKg, unit)} {unit} ×{' '}
                  {loggedRepsN ?? targetReps}
                </Text>
              ) : null}
            </>
          ) : loggedWeightKg !== null ? (
            <Text style={styles.prescription}>
              {formatNumber(loggedWeightKg, unit)} {unit} × {loggedRepsN ?? '—'}
            </Text>
          ) : (
            <Text style={styles.noTarget}>— registrá tu peso</Text>
          )}
        </View>

        {hasTarget ? (
          done ? (
            <Pressable
              onPress={onReport}
              accessibilityRole="button"
              accessibilityLabel={`Corregir el set ${index + 1}`}
              hitSlop={8}
              style={({ pressed }) => [styles.report, pressed && styles.pressed]}
            >
              <Ionicons name="create-outline" size={15} color={color.textFaint} />
            </Pressable>
          ) : (
            <Pressable
              onPress={onReport}
              accessibilityRole="button"
              accessibilityLabel={`No pude con el set ${index + 1}`}
              hitSlop={8}
              style={({ pressed }) => [styles.report, pressed && styles.pressed]}
            >
              <Text style={styles.reportText}>no pude</Text>
            </Pressable>
          )
        ) : null}

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
            done ? styles.checkDone : styles.checkPending,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={done ? 'checkmark' : 'ellipse-outline'}
            size={done ? 19 : 15}
            color={done ? color.onAccent : color.textFaint}
          />
        </Pressable>
      </View>

      {!done && why ? (
        <Text style={styles.why} numberOfLines={2}>
          {why}
        </Text>
      ) : null}

      {deviated ? <Text style={styles.deviatedNote}>Reportado · el motor lo tendrá en cuenta</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
    gap: 4,
  },
  rowNext: { backgroundColor: color.rowHighlight },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  indexBox: { width: 14 },
  indexBoxTagged: { width: 26 },
  index: {
    color: color.textFaint,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  kind: { color: color.accent, fontSize: 8, letterSpacing: 0.6 },
  target: { flex: 1, gap: 2 },
  prescription: {
    color: color.text,
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  prescriptionDone: { color: color.textMuted },
  noTarget: { color: color.textFaint, fontSize: 15, fontStyle: 'italic' },
  actual: { color: palette.a300, fontSize: 12, fontVariant: ['tabular-nums'] },
  report: { paddingHorizontal: 4, paddingVertical: 4 },
  reportText: { color: color.textFaint, fontSize: 11.5 },
  check: {
    width: 40,
    height: 40,
    borderRadius: radius.chip,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: color.accent, borderColor: color.accent },
  checkPending: { backgroundColor: 'transparent', borderColor: color.border },
  pressed: { opacity: 0.6 },
  why: { color: color.textMuted, fontSize: 12, marginLeft: 26 },
  deviatedNote: { color: color.textFaint, fontSize: 11, marginLeft: 26 },
});
