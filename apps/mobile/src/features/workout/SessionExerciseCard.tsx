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
import { SET_COLUMNS, SetRow } from './SetRow';
import { muscleLabel } from '@/lib/muscles';
import { formatRest } from '@/lib/prescription';
import type { Unit } from '@/lib/units';
import { color, palette, radius, space, type } from '@/theme/tokens';

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
  onHistory: () => void;
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
  onHistory,
}: Props) {
  const doneCount = sets.filter((s) => s.done).length;
  const allDone = doneCount === sets.length && sets.length > 0;

  const equipment = exercise.equipment ?? exercise.exercise?.equipment;
  const meta = [
    equipment,
    exercise.targetRir == null ? null : `${exercise.targetRir} RIR`,
    `descanso ${formatRest(exercise.restSeconds)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{muscleLabel(exercise.muscle)}</Text>
        </View>

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.name}>{exercise.name}</Text>
            <Text style={styles.meta}>{meta}</Text>
          </View>
          <Pressable
            onPress={onHistory}
            accessibilityRole="button"
            accessibilityLabel={`Historial de ${exercise.name}`}
            hitSlop={4}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="time-outline" size={21} color={palette.n400} />
          </Pressable>
          <View style={[styles.badge, allDone && styles.badgeDone]}>
            <Text style={[styles.badgeText, allDone && styles.badgeTextDone]}>
              {doneCount}/{sets.length}
            </Text>
          </View>
        </View>

        {/* La nota del coach va primero y en caja: es una instrucción, y se
            repite cada semana hasta que él la quite. */}
        {exercise.note ? (
          <View style={styles.pin}>
            <Ionicons name="pin-outline" size={15} color={color.pinText} />
            <View style={styles.pinBody}>
              <Text style={styles.pinText}>{exercise.note}</Text>
              <Text style={styles.pinWho}>Nota de tu coach</Text>
            </View>
          </View>
        ) : null}

        {/* La explicación del motor. Viaja desde el servidor tal cual: es lo que
            convierte un número en una decisión que el atleta entiende. */}
        {exercise.why ? (
          <View style={styles.why}>
            <Ionicons name="sparkles-outline" size={14} color={color.textMuted} />
            <Text style={styles.whyText}>{exercise.why}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.tableHead}>
        <View style={{ width: SET_COLUMNS.menu }} />
        <Text style={styles.th}>PESO ({unit.toUpperCase()})</Text>
        <Text style={styles.th}>REPS</Text>
        <View style={{ width: SET_COLUMNS.result }} />
        <Text style={[styles.th, styles.thLog]}>LOG</Text>
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
    paddingTop: space.lg,
    paddingBottom: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  top: { paddingHorizontal: space.lg, gap: space.sm },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    backgroundColor: color.bgSunken,
  },
  chipText: { ...type.label, color: palette.n400 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  headerText: { flex: 1, gap: 2 },
  name: { color: color.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2 },
  meta: { color: color.textMuted, fontSize: 13 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  badge: {
    marginTop: 6,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
  },
  badgeDone: { borderColor: color.accent, backgroundColor: color.bgSunken },
  badgeText: { color: color.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  badgeTextDone: { color: color.onAccent },
  pin: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: color.pinBg,
    borderWidth: 1,
    borderColor: color.pinBorder,
    borderRadius: radius.chip,
  },
  pinBody: { flex: 1, gap: 2 },
  pinText: { color: color.pinText, fontSize: 13, lineHeight: 18 },
  pinWho: { color: color.textMuted, fontSize: 11 },
  why: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  whyText: { flex: 1, color: color.textMuted, fontSize: 12.5, lineHeight: 17 },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    marginTop: space.sm,
    paddingLeft: space.xs,
    paddingRight: space.md,
  },
  th: { ...type.label, flex: 1, color: color.textMuted, textAlign: 'center' },
  thLog: { flex: 0, width: SET_COLUMNS.check },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  feedbackDone: { opacity: 0.6 },
  feedbackText: { color: color.accent, fontSize: 12.5, flex: 1 },
  feedbackTextDone: { color: palette.n400 },
});
