/**
 * Sesión de hoy.
 *
 * El atleta lee lo que pautó su coach, marca cada set y reporta si algo no le
 * salió. El coach ve la misma pantalla, pero con el lápiz para pautar cada
 * ejercicio: es su vista de "así queda el plan".
 */

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ExerciseCard } from '@/features/workout/ExerciseCard';
import { DeviationSheet } from '@/features/workout/DeviationSheet';
import { RestTimer } from '@/features/workout/RestTimer';
import { EditPlanSheet } from '@/features/coach/EditPlanSheet';
import { FeedbackSheet } from '@/features/feedback/FeedbackSheet';
import { useApp } from '@/stores/app';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { resolvePlan } from '@/lib/prescription';
import { color, space } from '@/theme/tokens';
import { formatLoad } from '@/lib/units';

export default function WorkoutScreen() {
  const role = useApp((s) => s.role);
  const canPrescribe = role === 'coach';

  const exercises = useSession((s) => s.exercises);
  const logs = useSession((s) => s.logs);
  const prescriptions = useSession((s) => s.prescriptions);
  const unit = useSession((s) => s.unit);
  const aggressiveness = useSession((s) => s.aggressiveness);
  const feedbackDone = useSession((s) => s.feedbackDone);
  const saveFeedback = useSession((s) => s.saveFeedback);
  const setPrescription = useSession((s) => s.setPrescription);
  const editSet = useSession((s) => s.editSet);

  const feedbackFor = useUi((s) => s.feedbackFor);
  const closeFeedback = useUi((s) => s.closeFeedback);
  const deviation = useUi((s) => s.deviation);
  const closeDeviation = useUi((s) => s.closeDeviation);
  const editPlanFor = useUi((s) => s.editPlanFor);
  const openEditPlan = useUi((s) => s.openEditPlan);
  const closeEditPlan = useUi((s) => s.closeEditPlan);

  const [rest, setRest] = useState<{ seconds: number; key: string } | null>(null);

  const summary = useMemo(() => {
    let totalSets = 0;
    let doneSets = 0;
    let volumeKg = 0;
    let firstPending: { exerciseId: string; index: number } | null = null;

    for (const ex of exercises) {
      const { sets } = resolvePlan(ex, prescriptions[ex.id], aggressiveness, logs[ex.id] ?? []);
      totalSets += sets.length;
      for (const s of sets) {
        if (s.done) {
          doneSets++;
          const w = s.loggedWeightKg ?? s.targetWeightKg;
          const r = parseInt(s.loggedReps ?? '', 10) || s.targetReps;
          volumeKg += w * r;
        } else if (!firstPending) {
          firstPending = { exerciseId: ex.id, index: s.index };
        }
      }
    }
    return { totalSets, doneSets, volumeKg, firstPending };
  }, [exercises, logs, prescriptions, aggressiveness]);

  const activeExercise = exercises.find((e) => e.id === feedbackFor) ?? null;
  const planningExercise = exercises.find((e) => e.id === editPlanFor) ?? null;

  const planningSuggestion = useMemo(() => {
    if (!planningExercise) return null;
    const { suggestion } = resolvePlan(
      planningExercise,
      prescriptions[planningExercise.id],
      aggressiveness,
      [],
    );
    return { sets: suggestion.sets, loadKg: suggestion.loadKg };
  }, [planningExercise, prescriptions, aggressiveness]);

  const startRest = useCallback((seconds: number, key: string) => {
    setRest({ seconds, key });
  }, []);

  return (
    <Screen
      title="WEEK 5 · DAY 1"
      subtitle={`Push A · ${summary.doneSets} de ${summary.totalSets} sets · ${formatLoad(
        Math.round(summary.volumeKg),
        unit,
      )} de volumen`}
    >
      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {exercises.map((ex) => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            unit={unit}
            aggressiveness={aggressiveness}
            feedbackSaved={!!feedbackDone[ex.id]}
            nextPendingIndex={
              summary.firstPending?.exerciseId === ex.id ? summary.firstPending.index : null
            }
            canPrescribe={canPrescribe}
            onMarkedDone={startRest}
            onEditPlan={() => openEditPlan(ex.id)}
          />
        ))}

        {summary.totalSets > 0 && summary.doneSets === summary.totalSets ? (
          <View style={styles.doneBanner}>
            <Text style={styles.doneTitle}>Sesión completa</Text>
            <Text style={styles.doneText}>
              Da feedback de cada ejercicio para que el motor ajuste la semana que viene.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <RestTimer
        seconds={rest?.seconds ?? 150}
        runKey={rest?.key ?? null}
        onDismiss={() => setRest(null)}
      />

      <FeedbackSheet
        exercise={activeExercise}
        unit={unit}
        aggressiveness={aggressiveness}
        onSave={(fb) => {
          if (activeExercise) saveFeedback(activeExercise.id, fb);
          closeFeedback();
        }}
        onClose={closeFeedback}
      />

      <DeviationSheet
        target={deviation}
        unit={unit}
        onSave={(weightKg, reps) => {
          if (deviation) {
            void editSet(deviation.exerciseId, deviation.index, {
              weightKg,
              reps: String(reps),
              done: true,
            });
          }
          closeDeviation();
        }}
        onReset={() => {
          if (deviation) {
            // Volver a la pauta: se borra lo reportado y queda como hecho tal cual.
            void editSet(deviation.exerciseId, deviation.index, {
              weightKg: deviation.targetWeightKg,
              reps: String(deviation.targetReps),
              done: true,
            });
          }
          closeDeviation();
        }}
        onClose={closeDeviation}
      />

      <EditPlanSheet
        exercise={canPrescribe ? planningExercise : null}
        prescription={planningExercise ? prescriptions[planningExercise.id] : undefined}
        suggestion={planningSuggestion}
        unit={unit}
        onSave={(patch) => {
          if (planningExercise) void setPrescription(planningExercise.id, patch);
          closeEditPlan();
        }}
        onClose={closeEditPlan}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, paddingTop: 0, gap: space.lg, paddingBottom: 96 },
  doneBanner: {
    backgroundColor: color.bgSunken,
    borderLeftWidth: 3,
    borderLeftColor: color.accent,
    padding: space.lg,
    gap: 4,
  },
  doneTitle: { color: color.text, fontSize: 16, fontWeight: '600' },
  doneText: { color: color.textMuted, fontSize: 13, lineHeight: 19 },
});
