/**
 * Bottom sheet de feedback: las cuatro preguntas del prototipo y, debajo, el
 * preview en vivo de lo que hará el motor la semana que viene.
 *
 * Ese preview es lo que separa esto de un formulario: el atleta ve la
 * consecuencia de su respuesta antes de guardarla. Se calcula llamando a
 * `planExercise` con `feedbackOverride`, que es exactamente para lo que existe
 * ese tercer parámetro.
 *
 * Modal nativo en vez de una librería de sheets: menos dependencias que puedan
 * romperse al subir de SDK, y el gesto de cerrar lo da el propio Modal.
 */

import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Aggressiveness,
  Exercise,
  Feedback,
  JointPain,
  Pump,
  Soreness,
  WorkloadFeel,
  planExercise,
} from '@cage/engine';
import { Chip } from '@/components/Chip';
import { color, radius, space } from '@/theme/tokens';
import { Unit, formatLoad } from '@/lib/units';

interface Question {
  key: keyof Feedback;
  title: string;
  help: string;
  options: string[];
}

const QUESTIONS: Question[] = [
  {
    key: 'joint',
    title: 'Dolor articular',
    help: '¿Cómo sintieron tus articulaciones este ejercicio?',
    options: [JointPain.None, JointPain.Little, JointPain.Moderate, JointPain.Severe],
  },
  {
    key: 'soreness',
    title: 'Soreness',
    help: '¿Qué tan adolorido quedaste del último día de este músculo?',
    options: [Soreness.Never, Soreness.GoneDaysAgo, Soreness.GoneJustInTime, Soreness.StillSore],
  },
  {
    key: 'pump',
    title: 'Pump',
    help: '¿Cuánto pump conseguiste hoy?',
    options: [Pump.Low, Pump.Moderate, Pump.Amazing],
  },
  {
    key: 'volume',
    title: 'Volumen (hard sets)',
    help: '¿Cómo se sintió el número de series duras?',
    options: [
      WorkloadFeel.NotEnough,
      WorkloadFeel.Right,
      WorkloadFeel.AtLimit,
      WorkloadFeel.TooMuch,
    ],
  },
];

interface Props {
  exercise: Exercise | null;
  unit: Unit;
  aggressiveness: Aggressiveness;
  onSave: (feedback: Feedback) => void;
  onClose: () => void;
}

export function FeedbackSheet({ exercise, unit, aggressiveness, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Feedback | null>(null);
  const feedback = draft ?? exercise?.last.feedback ?? null;

  const preview = useMemo(() => {
    if (!exercise || !feedback) return null;
    const base = planExercise(exercise, aggressiveness);
    const next = planExercise(exercise, aggressiveness, feedback);
    return describe(next, base.sets, unit);
  }, [exercise, feedback, aggressiveness, unit]);

  return (
    <Modal
      visible={exercise != null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Feedback</Text>
          <Text style={styles.subject}>{exercise?.name}</Text>

          {feedback
            ? QUESTIONS.map((q) => (
                <View key={q.key} style={styles.question}>
                  <Text style={styles.questionTitle}>{q.title}</Text>
                  <Text style={styles.questionHelp}>{q.help}</Text>
                  <View style={styles.options}>
                    {q.options.map((o) => (
                      <Chip
                        key={o}
                        label={o}
                        active={feedback[q.key] === o}
                        onPress={() => setDraft({ ...feedback, [q.key]: o } as Feedback)}
                      />
                    ))}
                  </View>
                </View>
              ))
            : null}

          {preview ? (
            <View style={styles.preview}>
              <Text style={styles.previewLabel}>La próxima semana</Text>
              <Text style={styles.previewText}>{preview}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Cancelar</Text>
          </Pressable>
          <Pressable
            onPress={() => feedback && onSave(feedback)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Guardar feedback</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Frase del preview, con la misma estructura que el prototipo. */
function describe(
  next: ReturnType<typeof planExercise>,
  currentSets: number,
  unit: Unit,
): string {
  const loadPart =
    next.deltaKg === 0
      ? `mantendrá ${formatLoad(next.loadKg, unit)}`
      : `${next.deltaKg > 0 ? 'subirá a' : 'bajará a'} ${formatLoad(next.loadKg, unit)} ` +
        `(${next.deltaKg > 0 ? '+' : '−'}${formatLoad(Math.abs(next.deltaKg), unit)})`;

  const diff = Math.abs(next.sets - currentSets);
  const setsPart =
    next.sets === currentSets
      ? `con los mismos ${next.sets} hard sets`
      : `${next.sets > currentSets ? 'y sumará' : 'y recortará'} ${diff} hard set${
          diff === 1 ? '' : 's'
        } (${currentSets} → ${next.sets})`;

  const e1 = Math.round(next.e1rmNext * 10) / 10;
  return `${loadPart} ${setsPart} · ${next.why}. e1RM proyectado ${formatLoad(e1, unit)}.`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '86%',
    backgroundColor: color.bgRaised,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    borderColor: color.border,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border,
    alignSelf: 'center',
    marginTop: space.md,
  },
  content: { padding: space.lg, gap: space.lg },
  title: { color: color.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  subject: { color: color.textMuted, fontSize: 13, marginTop: -space.md },
  question: { gap: space.sm },
  questionTitle: { color: color.text, fontSize: 15, fontWeight: '600' },
  questionHelp: { color: color.textMuted, fontSize: 12 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 2 },
  preview: {
    backgroundColor: color.bgSunken,
    borderLeftWidth: 3,
    borderLeftColor: color.accent,
    padding: space.md,
    gap: 4,
  },
  previewLabel: {
    color: color.textFaint,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '600',
  },
  previewText: { color: color.text, fontSize: 13, lineHeight: 19 },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  secondary: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
  },
  secondaryText: { color: color.textMuted, fontSize: 14, fontWeight: '500' },
  primary: {
    flex: 1,
    paddingVertical: space.md,
    borderRadius: radius.chip,
    backgroundColor: color.accent,
    alignItems: 'center',
  },
  primaryText: { color: color.onAccent, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
