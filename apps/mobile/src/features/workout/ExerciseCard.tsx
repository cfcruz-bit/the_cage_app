/**
 * Tarjeta de un ejercicio dentro de la sesión.
 *
 * Aquí se resuelve el plan de ESTE ejercicio —motor + prescripción del coach—
 * dentro de un `useMemo` sobre su propio log. Tocar un set del ejercicio 1 no
 * replantea el ejercicio 3.
 */

import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Aggressiveness, Exercise, SetLogEntry } from '@cage/engine';
import { SetRow } from './SetRow';
import { color, palette, radius, space } from '@/theme/tokens';
import { Unit, formatLoad } from '@/lib/units';
import { Prescription, formatRest, isAutomatic, resolvePlan } from '@/lib/prescription';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';

interface Props {
  exercise: Exercise;
  unit: Unit;
  aggressiveness: Aggressiveness;
  feedbackSaved: boolean;
  /** Índice del próximo set pendiente en este ejercicio, o null. */
  nextPendingIndex: number | null;
  /** El coach ve y edita la pauta; el atleta solo la ejecuta. */
  canPrescribe: boolean;
  onMarkedDone: (restSeconds: number, key: string) => void;
  onEditPlan: () => void;
}

export const ExerciseCard = memo(function ExerciseCard({
  exercise,
  unit,
  aggressiveness,
  feedbackSaved,
  nextPendingIndex,
  canPrescribe,
  onMarkedDone,
  onEditPlan,
}: Props) {
  const logs = useSession(useCallback((s) => s.logs[exercise.id] ?? EMPTY, [exercise.id]));
  const prescription = useSession(
    useCallback((s) => s.prescriptions[exercise.id], [exercise.id]),
  );
  const toggleSet = useSession((s) => s.toggleSet);
  const openFeedback = useUi((s) => s.openFeedback);
  const openDeviation = useUi((s) => s.openDeviation);

  const { plan, sets, overridden } = useMemo(
    () => resolvePlan(exercise, prescription, aggressiveness, logs),
    [exercise, prescription, aggressiveness, logs],
  );

  const restSeconds = prescription?.restSeconds ?? 150;
  const allDone = sets.every((s) => s.done);
  const auto = isAutomatic(prescription);

  function mark(index: number, targetKg: number, targetReps: number) {
    const wasDone = logs[index]?.done ?? false;
    void toggleSet(exercise.id, index, targetKg, targetReps);
    // El descanso solo arranca al completar, no al desmarcar.
    if (!wasDone) onMarkedDone(restSeconds, `${exercise.id}:${index}:${Date.now()}`);
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.muscle}>{exercise.muscle}</Text>
          <Text style={styles.name}>{exercise.name}</Text>
          <Text style={styles.equipment}>{exercise.equipment}</Text>
        </View>

        {canPrescribe ? (
          <Pressable
            onPress={onEditPlan}
            accessibilityRole="button"
            accessibilityLabel={`Pautar ${exercise.name}`}
            hitSlop={8}
            style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
          >
            <Ionicons name="create-outline" size={16} color={color.accent} />
          </Pressable>
        ) : null}

        <View style={[styles.badge, allDone && styles.badgeDone]}>
          <Text style={[styles.badgeText, allDone && styles.badgeTextDone]}>
            {sets.filter((s) => s.done).length}/{sets.length}
          </Text>
        </View>
      </View>

      <View style={styles.targets}>
        <Text style={styles.target}>
          {plan.sets} × {exercise.repLo}–{exercise.repHi} · RIR {exercise.targetRir} · descanso{' '}
          {formatRest(restSeconds)}
        </Text>
        {!auto ? (
          <View style={styles.coachTag}>
            <Ionicons name="person" size={9} color={palette.a200} />
            <Text style={styles.coachTagText}>PAUTADO</Text>
          </View>
        ) : (
          <Text style={[styles.note, plan.deltaKg > 0 && styles.noteUp, plan.deltaKg < 0 && styles.noteDown]}>
            {deltaNote(plan.deltaKg, plan.setNote, unit)}
          </Text>
        )}
      </View>

      {sets.map((s) => (
        <SetRow
          key={s.index}
          index={s.index}
          unit={unit}
          targetWeightKg={s.targetWeightKg}
          targetReps={s.targetReps}
          why={s.why}
          loggedWeightKg={s.loggedWeightKg}
          loggedReps={s.loggedReps}
          done={s.done}
          isNext={nextPendingIndex === s.index}
          onToggle={() => mark(s.index, s.targetWeightKg, s.targetReps)}
          onReport={() =>
            openDeviation({
              exerciseId: exercise.id,
              exerciseName: exercise.name,
              index: s.index,
              targetWeightKg: s.targetWeightKg,
              targetReps: s.targetReps,
              loggedWeightKg: s.loggedWeightKg,
              loggedReps: s.loggedReps,
            })
          }
        />
      ))}

      <Pressable
        onPress={() => openFeedback(exercise.id)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.feedback, pressed && styles.pressed]}
      >
        <Ionicons
          name={feedbackSaved ? 'checkmark-circle-outline' : 'chatbubble-ellipses-outline'}
          size={15}
          color={feedbackSaved ? color.textMuted : color.accent}
        />
        <Text style={[styles.feedbackText, feedbackSaved && styles.feedbackTextSaved]}>
          {feedbackSaved ? 'Feedback guardado · editar' : 'Dar feedback del ejercicio'}
        </Text>
      </Pressable>
    </View>
  );
});

const EMPTY: SetLogEntry[] = [];

/** "+2.5 kg" / "−5 kg" / "+1 set" / "mantener" */
function deltaNote(deltaKg: number, setNote: string | null, unit: Unit): string {
  if (deltaKg > 0) return `+${formatLoad(deltaKg, unit)}`;
  if (deltaKg < 0) return `−${formatLoad(-deltaKg, unit)}`;
  return setNote ?? 'mantener';
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    paddingBottom: space.sm,
  },
  headerText: { flex: 1, gap: 2 },
  muscle: { color: color.textFaint, fontSize: 10, letterSpacing: 2, fontWeight: '600' },
  name: { color: color.text, fontSize: 16, fontWeight: '600' },
  equipment: { color: color.textMuted, fontSize: 12 },
  edit: {
    width: 30,
    height: 30,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
  },
  badgeDone: { borderColor: color.accent, backgroundColor: color.bgSunken },
  badgeText: { color: color.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  badgeTextDone: { color: color.onAccent },
  targets: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  target: { color: color.textMuted, fontSize: 12, flex: 1 },
  note: { color: color.textMuted, fontSize: 12, fontWeight: '600' },
  noteUp: { color: color.accent },
  noteDown: { color: color.danger },
  coachTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 2,
    backgroundColor: palette.a800,
  },
  coachTagText: { color: palette.a200, fontSize: 9, letterSpacing: 1.4, fontWeight: '600' },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  feedbackText: { color: color.accent, fontSize: 13, fontWeight: '500' },
  feedbackTextSaved: { color: color.textMuted },
  pressed: { opacity: 0.6 },
});
