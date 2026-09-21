/**
 * Sesión de hoy.
 *
 * Lo que se entrena aquí es lo que el coach generó en el servidor: carga,
 * series y la explicación de por qué salen ya resueltas de ahí. La app no
 * recalcula el plan — eso era la demo local, y tener dos implementaciones del
 * mismo cálculo es tener dos que pueden discrepar.
 *
 * **Entrenar nunca espera a la red.** Cada set marcado se pinta al instante,
 * se escribe en SQLite y se encola. Si hay cobertura sube en segundos; si no,
 * sube cuando vuelva. Lo único que cambia es el contador de pendientes de
 * arriba.
 *
 * El coach ve la misma pantalla —es su vista de "así le queda el día"— y desde
 * aquí genera la sesión.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Feedback } from '@cage/engine';

import type { SessionOut } from '@/api/types';
import { Screen } from '@/components/Screen';
import { DeviationSheet } from '@/features/workout/DeviationSheet';
import { FeedbackSheet } from '@/features/feedback/FeedbackSheet';
import { RestTimer } from '@/features/workout/RestTimer';
import { SessionExerciseCard } from '@/features/workout/SessionExerciseCard';
import { GenerateSessionSheet } from '@/features/workout/GenerateSessionSheet';
import { useApp } from '@/stores/app';
import { useSession } from '@/stores/session';
import { useSync } from '@/stores/sync';
import { resolveSet, useWorkout } from '@/stores/workout';
import { color, radius, space } from '@/theme/tokens';
import { formatLoad } from '@/lib/units';

export default function WorkoutScreen() {
  const isCoach = useApp((s) => s.role) === 'coach';

  const session = useWorkout((s) => s.session);
  const loading = useWorkout((s) => s.loading);
  const stale = useWorkout((s) => s.stale);
  const error = useWorkout((s) => s.error);
  const marks = useWorkout((s) => s.marks);
  const feedbackDone = useWorkout((s) => s.feedbackDone);
  const load = useWorkout((s) => s.load);
  const toggleSet = useWorkout((s) => s.toggleSet);
  const reportSet = useWorkout((s) => s.reportSet);
  const saveFeedback = useWorkout((s) => s.saveFeedback);

  const unit = useSession((s) => s.unit);
  const pending = useSync((s) => s.pending);

  const [rest, setRest] = useState<{ seconds: number; key: string } | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [deviation, setDeviation] = useState<{
    exerciseId: string;
    index: number;
  } | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  /** El plan del servidor con las marcas locales encima. */
  const resolved = useMemo(() => {
    if (session === null) return [];
    return session.exercises.map((exercise) => ({
      exercise,
      sets: exercise.sets.map((s) => ({
        index: s.index,
        targetWeightKg: s.targetWeightKg,
        targetReps: s.targetReps,
        why: s.why,
        ...resolveSet(marks, exercise.id, s.index, {
          done: s.done,
          loggedWeightKg: s.loggedWeightKg,
          loggedReps: s.loggedReps,
        }),
      })),
    }));
  }, [session, marks]);

  const summary = useMemo(() => {
    let total = 0;
    let done = 0;
    let volumeKg = 0;
    let firstPending: { exerciseId: string; index: number } | null = null;

    for (const { exercise, sets } of resolved) {
      for (const s of sets) {
        total += 1;
        if (s.done) {
          done += 1;
          // Sin ningún peso -ni registrado, ni planificado- no hay nada que
          // sumar al tonelaje: inventar un cero sería mentir sobre el volumen.
          const kg = s.loggedWeightKg ?? s.targetWeightKg;
          if (kg !== null) {
            const reps = Number.parseInt(s.loggedReps ?? '', 10);
            volumeKg += kg * (Number.isFinite(reps) ? reps : (s.targetReps ?? 0));
          }
        } else if (firstPending === null) {
          firstPending = { exerciseId: exercise.id, index: s.index };
        }
      }
    }
    return { total, done, volumeKg, firstPending };
  }, [resolved]);

  const onToggle = useCallback(
    (exerciseId: string, restSeconds: number) =>
      (index: number, targetWeightKg: number, targetReps: number) => {
        void toggleSet(exerciseId, index, targetWeightKg, targetReps);
        setRest({ seconds: restSeconds, key: `${exerciseId}:${index}` });
      },
    [toggleSet],
  );

  if (loading && session === null) {
    return (
      <Screen title="SESIÓN DE HOY">
        <View style={styles.center}>
          <ActivityIndicator color={color.accent} />
        </View>
      </Screen>
    );
  }

  if (session === null) {
    return (
      <Screen title="SESIÓN DE HOY">
        <View style={styles.center}>
          <Ionicons name="barbell-outline" size={30} color={color.textFaint} />
          <Text style={styles.emptyTitle}>
            {error ?? 'Nada programado todavía'}
          </Text>
          <Text style={styles.emptyBody}>
            {isCoach
              ? 'Generá la sesión del día para tu atleta desde un mesociclo activo.'
              : 'Tu coach todavía no te generó la sesión de hoy. En cuanto lo haga, aparece acá.'}
          </Text>

          {isCoach ? (
            <Pressable
              onPress={() => setGenerating(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.actionText}>GENERAR SESIÓN</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void load()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.emptyBody}>Comprobar de nuevo</Text>
            </Pressable>
          )}
        </View>

        {isCoach ? (
          <GenerateSessionSheet
            visible={generating}
            onClose={() => setGenerating(false)}
            onCreated={() => {
              setGenerating(false);
              void load();
            }}
          />
        ) : null}
      </Screen>
    );
  }

  const active = resolved.find((r) => r.exercise.id === feedbackFor);
  const deviationTarget =
    deviation === null
      ? null
      : (() => {
          const row = resolved.find((r) => r.exercise.id === deviation.exerciseId);
          const s = row?.sets.find((x) => x.index === deviation.index);
          if (row === undefined || s === undefined) return null;
          return {
            exerciseId: row.exercise.id,
            exerciseName: row.exercise.name,
            index: s.index,
            targetWeightKg: s.targetWeightKg,
            targetReps: s.targetReps,
            loggedWeightKg: s.loggedWeightKg,
            loggedReps: s.loggedReps,
          };
        })();

  return (
    <Screen
      title={session.dayLabel.toUpperCase()}
      subtitle={`Semana ${session.weekNumber} · ${summary.done} de ${summary.total} sets · ${formatLoad(
        Math.round(summary.volumeKg),
        unit,
      )} de volumen`}
    >
      {stale || pending > 0 ? (
        <View style={styles.banner}>
          <Ionicons
            name={stale ? 'cloud-offline-outline' : 'cloud-upload-outline'}
            size={13}
            color={color.textMuted}
          />
          <Text style={styles.bannerText}>
            {stale
              ? 'Sin conexión. Estás viendo lo último guardado; lo que marques se sube solo.'
              : `${pending} ${pending === 1 ? 'cambio' : 'cambios'} por subir.`}
          </Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={color.accent}
          />
        }
      >
        {resolved.map(({ exercise, sets }) => (
          <SessionExerciseCard
            key={exercise.id}
            exercise={exercise}
            sets={sets}
            unit={unit}
            feedbackSaved={feedbackDone[exercise.id] === true}
            nextPendingIndex={
              summary.firstPending?.exerciseId === exercise.id
                ? summary.firstPending.index
                : null
            }
            onToggle={(index) => {
              const s = sets.find((x) => x.index === index);
              // Sin objetivo no hay nada que asumir al tocar el check: ese
              // caso lo resuelve SetRow abriendo el reporte, no este callback.
              if (s === undefined || s.targetWeightKg === null || s.targetReps === null) {
                return;
              }
              onToggle(exercise.id, exercise.restSeconds)(
                index,
                s.targetWeightKg,
                s.targetReps,
              );
            }}
            onReport={(index) => setDeviation({ exerciseId: exercise.id, index })}
            onFeedback={() => setFeedbackFor(exercise.id)}
          />
        ))}

        {summary.total > 0 && summary.done === summary.total ? (
          <SessionDone />
        ) : null}
      </ScrollView>

      {rest !== null ? (
        <RestTimer
          seconds={rest.seconds}
          runKey={rest.key}
          onDismiss={() => setRest(null)}
        />
      ) : null}

      <FeedbackSheet
        exercise={active?.exercise.exercise ?? null}
        unit={unit}
        aggressiveness="Media"
        onSave={(feedback: Feedback) => {
          if (feedbackFor !== null) void saveFeedback(feedbackFor, feedback);
          setFeedbackFor(null);
        }}
        onClose={() => setFeedbackFor(null)}
      />

      <DeviationSheet
        target={deviationTarget}
        unit={unit}
        onSave={(weightKg, reps) => {
          if (deviation !== null) {
            void reportSet(deviation.exerciseId, deviation.index, {
              weightKg,
              reps: String(reps),
              rpe: null,
            });
          }
          setDeviation(null);
        }}
        onReset={() => setDeviation(null)}
        onClose={() => setDeviation(null)}
      />
    </Screen>
  );
}

/** Lo que se ve al terminar. Cerrar la sesión es lo que la hace contar. */
function SessionDone() {
  const complete = useWorkout((s) => s.complete);
  const load = useWorkout((s) => s.load);
  const [closing, setClosing] = useState(false);

  return (
    <View style={styles.doneBanner}>
      <Text style={styles.doneTitle}>Sesión completa</Text>
      <Text style={styles.doneText}>
        Da feedback de cada ejercicio antes de cerrar: es lo que el motor usa
        para ajustar la semana que viene.
      </Text>
      <Pressable
        onPress={() => {
          setClosing(true);
          void complete().then(() => load());
        }}
        disabled={closing}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.action,
          closing && { opacity: 0.5 },
          pressed && !closing && { opacity: 0.7 },
        ]}
      >
        <Text style={styles.actionText}>CERRAR SESIÓN</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, paddingTop: space.sm, gap: space.md, paddingBottom: 96 },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xxl,
    paddingVertical: 64,
  },
  emptyTitle: {
    color: color.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: space.xs,
  },
  emptyBody: { color: color.textMuted, fontSize: 12.5, lineHeight: 19, textAlign: 'center' },
  retry: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: space.sm,
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
  },
  bannerText: { color: color.textMuted, fontSize: 11.5, flex: 1, lineHeight: 16 },

  doneBanner: {
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: color.rowHighlight,
    gap: space.sm,
  },
  doneTitle: { color: color.text, fontSize: 15, fontWeight: '600' },
  doneText: { color: color.textMuted, fontSize: 12.5, lineHeight: 18 },

  action: {
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: radius.chip,
    marginTop: space.xs,
    alignSelf: 'stretch',
  },
  actionText: {
    color: color.onAccent,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2.4,
  },
});
