/**
 * Un ejercicio de la sesión del servidor.
 *
 * A diferencia de la tarjeta anterior, esta NO calcula nada: el plan viene
 * resuelto del servidor, con su carga, sus series y la explicación de por qué.
 * Lo único que pasa aquí es pintar y recoger lo que el atleta marca.
 *
 * Que el cálculo esté en un solo sitio importa: mientras el móvil resolvía su
 * propio plan, había dos implementaciones que podían discrepar. Ahora el móvil
 * muestra lo que se persistió, que es lo que el coach ve y lo que alimentará
 * la semana que viene.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { SessionExerciseOut } from '@/api/types';
import { SetRow } from './SetRow';
import { muscleLabel } from '@/lib/muscles';
import { formatRest } from '@/lib/prescription';
import { type Unit, formatLoad } from '@/lib/units';
import { color, palette, radius, space } from '@/theme/tokens';

interface ResolvedSet {
  index: number;
  targetWeightKg: number | null;
  targetReps: number | null;
  why: string;
  loggedWeightKg: number | null;
  loggedReps: string | null;
  done: boolean;
  backoff: boolean;
}

interface Props {
  exercise: SessionExerciseOut;
  sets: ResolvedSet[];
  unit: Unit;
  feedbackSaved: boolean;
  /** Índice del próximo set pendiente en este ejercicio, o null. */
  nextPendingIndex: number | null;
  onToggle: (index: number) => void;
  onReport: (index: number) => void;
  onFeedback: () => void;
}

export const SessionExerciseCard = memo(function SessionExerciseCard({
  exercise,
  sets,
  unit,
  feedbackSaved,
  nextPendingIndex,
  onToggle,
  onReport,
  onFeedback,
}: Props) {
  const doneCount = sets.filter((s) => s.done).length;
  const allDone = doneCount === sets.length && sets.length > 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.muscle}>{muscleLabel(exercise.muscle)}</Text>
          <Text style={styles.name}>{exercise.name}</Text>
        </View>
        <View style={[styles.badge, allDone && styles.badgeDone]}>
          <Text style={[styles.badgeText, allDone && styles.badgeTextDone]}>
            {doneCount}/{sets.length}
          </Text>
        </View>
      </View>

      <View style={styles.targets}>
        <Text style={styles.target}>
          {exercise.plannedLoadKg === null
            ? 'Sin carga todavía'
            : formatLoad(exercise.plannedLoadKg, unit)}{' '}
          · {exercise.plannedSets} {exercise.backoffSets == null ? 'sets' : 'top'}
          {exercise.backoffSets != null && exercise.backoffLoadKg != null
            ? ` + ${exercise.backoffSets}×${exercise.backoffReps} back-off a ${formatLoad(exercise.backoffLoadKg, unit)}`
            : ''}
        </Text>
        <Text style={styles.target}>
          descanso {formatRest(exercise.restSeconds)}
        </Text>
      </View>

      {/* La explicación del motor. Viaja desde el servidor tal cual: es lo que
          convierte un número en una decisión que el atleta entiende. */}
      <Text style={styles.why}>{exercise.why}</Text>

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
          kind={exercise.backoffSets == null ? undefined : s.backoff ? 'backoff' : 'top'}
          onToggle={() => onToggle(s.index)}
          onReport={() => onReport(s.index)}
        />
      ))}

      {allDone ? (
        <Pressable
          onPress={onFeedback}
          disabled={feedbackSaved}
          accessibilityRole="button"
          accessibilityLabel={`Feedback de ${exercise.name}`}
          style={({ pressed }) => [
            styles.feedback,
            feedbackSaved && styles.feedbackDone,
            pressed && !feedbackSaved && { opacity: 0.7 },
          ]}
        >
          <Ionicons
            name={feedbackSaved ? 'checkmark-circle' : 'chatbubble-ellipses-outline'}
            size={15}
            color={feedbackSaved ? palette.n400 : color.accent}
          />
          <Text style={[styles.feedbackText, feedbackSaved && styles.feedbackTextDone]}>
            {feedbackSaved
              ? 'Feedback enviado'
              : '¿Cómo te fue? Ajusta la semana que viene'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

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
  muscle: { color: color.textMuted, fontSize: 12.5 },
  name: { color: color.text, fontSize: 16, fontWeight: '600' },
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
    paddingHorizontal: space.md,
    paddingBottom: 2,
    gap: space.sm,
  },
  target: { color: color.textMuted, fontSize: 12.5 },
  why: {
    color: color.textFaint,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  feedbackDone: { opacity: 0.6 },
  feedbackText: { color: color.accent, fontSize: 12.5, flex: 1 },
  feedbackTextDone: { color: palette.n400 },
});
