/**
 * Feedback por músculo, preguntado cuando se sabe la respuesta.
 *
 * Antes eran cuatro preguntas por ejercicio al terminarlo. Dos cosas estaban
 * mal en eso:
 *
 * - **Las agujetas hablan de la vez anterior.** "Se fue justo a tiempo" solo se
 *   sabe al volver a entrenar el músculo, así que se preguntan al empezarlo
 *   (`SorenessAsk`), antes del primer set.
 * - **El pump y la carga son del músculo, no del ejercicio.** Con dos ejercicios
 *   de cuádriceps el atleta contestaba lo mismo dos veces. Ahora se preguntan
 *   una vez, al terminar el último ejercicio de ese músculo del día.
 *
 * El dolor articular sí es de cada ejercicio: una extensión puede doler y la
 * prensa no.
 *
 * El servidor y el motor no cambian: se sigue guardando un feedback por
 * ejercicio, con lo del músculo copiado en cada uno. Y se mantiene el preview:
 * el atleta ve qué hará el motor con su respuesta antes de guardarla, calculado
 * con `planExercise` y su `feedbackOverride`.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  type Aggressiveness,
  type Exercise,
  type Feedback,
  JointPain,
  Pump,
  Soreness,
  WorkloadFeel,
  planExercise,
} from '@cage/engine';

import { Chip } from '@/components/Chip';
import { type Unit, formatLoad } from '@/lib/units';
import { color, radius, space } from '@/theme/tokens';

const SORENESS = [Soreness.Never, Soreness.GoneDaysAgo, Soreness.GoneJustInTime, Soreness.StillSore];
const PUMP = [Pump.Low, Pump.Moderate, Pump.Amazing];
const WORKLOAD = [WorkloadFeel.NotEnough, WorkloadFeel.Right, WorkloadFeel.AtLimit, WorkloadFeel.TooMuch];
const JOINT = [JointPain.None, JointPain.Little, JointPain.Moderate, JointPain.Severe];

function Options<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.options}>
      {options.map((o) => (
        <Chip key={o} label={o} active={value === o} onPress={() => onChange(o)} />
      ))}
    </View>
  );
}

/* ── Agujetas, al empezar el músculo ──────────────────────────────────────── */

export function SorenessAsk({
  muscle,
  value,
  onChange,
}: {
  muscle: string;
  value: Soreness | null;
  onChange: (v: Soreness) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (value !== null && !editing) {
    return (
      <View style={styles.answered}>
        <Ionicons name="checkmark-circle-outline" size={15} color={color.textMuted} />
        <Text style={styles.answeredText}>
          Agujetas de {muscle.toLowerCase()}:{' '}
          <Text style={styles.answeredValue}>{value.toLowerCase()}</Text>
        </Text>
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.link}>Cambiar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.ask}>
      <Text style={styles.askText}>
        ¿Cómo llegaste de agujetas en {muscle.toLowerCase()} desde la última vez?
      </Text>
      <Options
        options={SORENESS}
        value={value}
        onChange={(v) => {
          onChange(v);
          setEditing(false);
        }}
      />
    </View>
  );
}

/* ── Pump, carga y articulaciones, al terminar el músculo ─────────────────── */

export interface MuscleFeedbackExercise {
  id: string;
  name: string;
  /** El ejercicio como lo entiende el motor; null sin ningún peso todavía. */
  exercise: Exercise | null;
}

interface Props {
  muscle: string;
  exercises: MuscleFeedbackExercise[];
  /** Lo que contestó al empezar el músculo; si no contestó, se pregunta aquí. */
  soreness: Soreness | null;
  unit: Unit;
  aggressiveness: Aggressiveness;
  onSave: (byExercise: Record<string, Feedback>) => void;
}

export function MuscleFeedback({ muscle, exercises, soreness, unit, aggressiveness, onSave }: Props) {
  // Arranca con lo que contestó la vez anterior: casi siempre es lo mismo, y
  // así el caso normal es un toque.
  const last = exercises.find((e) => e.exercise !== null)?.exercise?.last.feedback ?? null;
  const [pump, setPump] = useState<Pump | null>(last?.pump ?? null);
  const [volume, setVolume] = useState<WorkloadFeel | null>(last?.volume ?? null);
  const [sore, setSore] = useState<Soreness | null>(null);
  const [joint, setJoint] = useState<Record<string, JointPain | null>>(() =>
    Object.fromEntries(exercises.map((e) => [e.id, e.exercise?.last.feedback.joint ?? null])),
  );

  const soreValue = soreness ?? sore;
  const byExercise = useMemo(() => {
    if (pump === null || volume === null || soreValue === null) return null;
    const out: Record<string, Feedback> = {};
    for (const e of exercises) {
      const j = joint[e.id];
      if (j == null) return null;
      out[e.id] = { joint: j, soreness: soreValue, pump, volume };
    }
    return out;
  }, [pump, volume, soreValue, joint, exercises]);

  const previews = useMemo(() => {
    if (byExercise === null) return [];
    return exercises.flatMap((e) => {
      const fb = byExercise[e.id];
      if (e.exercise === null || fb === undefined) return [];
      const base = planExercise(e.exercise, aggressiveness);
      const next = planExercise(e.exercise, aggressiveness, fb);
      return [{ name: e.name, text: describe(next, base.sets, unit) }];
    });
  }, [byExercise, exercises, aggressiveness, unit]);

  return (
    <View style={styles.card} accessibilityLabel={`Feedback de ${muscle}`}>
      <Text style={styles.title}>{muscle} terminado</Text>
      <Text style={styles.lead}>
        {exercises.length > 1
          ? 'Dos preguntas para el músculo entero y una por ejercicio.'
          : 'Tres preguntas rápidas. Ajustan la semana que viene.'}
      </Text>

      {soreness === null ? (
        <View style={styles.question}>
          <Text style={styles.qTitle}>
            Agujetas <Text style={styles.qHelp}>desde la última vez que lo entrenaste</Text>
          </Text>
          <Options options={SORENESS} value={sore} onChange={setSore} />
        </View>
      ) : null}

      <View style={styles.question}>
        <Text style={styles.qTitle}>
          Pump <Text style={styles.qHelp}>en {muscle.toLowerCase()} hoy</Text>
        </Text>
        <Options options={PUMP} value={pump} onChange={setPump} />
      </View>

      <View style={styles.question}>
        <Text style={styles.qTitle}>
          Carga <Text style={styles.qHelp}>¿cómo se sintieron las series duras?</Text>
        </Text>
        <Options options={WORKLOAD} value={volume} onChange={setVolume} />
      </View>

      <View style={[styles.question, styles.jointBlock]}>
        <Text style={styles.qTitle}>
          Dolor articular <Text style={styles.qHelp}>por ejercicio</Text>
        </Text>
        {exercises.map((e) => (
          <View key={e.id} style={styles.jointRow}>
            {exercises.length > 1 ? <Text style={styles.jointName}>{e.name}</Text> : null}
            <Options
              options={JOINT}
              value={joint[e.id] ?? null}
              onChange={(v) => setJoint((j) => ({ ...j, [e.id]: v }))}
            />
          </View>
        ))}
      </View>

      {previews.length > 0 ? (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>La próxima semana</Text>
          {previews.map((p) => (
            <Text key={p.name} style={styles.previewText}>
              {previews.length > 1 ? <Text style={styles.previewName}>{p.name}: </Text> : null}
              {p.text}
            </Text>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={() => byExercise !== null && onSave(byExercise)}
        disabled={byExercise === null}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.save,
          byExercise === null && styles.saveDisabled,
          pressed && byExercise !== null && { opacity: 0.7 },
        ]}
      >
        <Text style={styles.saveText}>GUARDAR FEEDBACK</Text>
      </Pressable>
    </View>
  );
}

/** Frase del preview, con la misma estructura que el prototipo. */
function describe(next: ReturnType<typeof planExercise>, currentSets: number, unit: Unit): string {
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

  return `${loadPart} ${setsPart} · ${next.why}.`;
}

const styles = StyleSheet.create({
  answered: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  answeredText: { flex: 1, color: color.textMuted, fontSize: 12.5 },
  answeredValue: { color: color.text },
  link: { color: color.accent, fontSize: 12.5 },
  ask: {
    gap: space.sm,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    backgroundColor: color.bgRaised,
  },
  askText: { color: color.text, fontSize: 13.5, lineHeight: 18 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  card: {
    marginHorizontal: space.lg,
    marginVertical: space.md,
    padding: space.md,
    gap: space.md,
    borderWidth: 1,
    borderColor: color.accent,
    borderRadius: radius.card,
    backgroundColor: color.bgRaised,
  },
  title: { color: color.text, fontSize: 16, fontWeight: '600' },
  lead: { color: color.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: -space.sm },
  question: { gap: space.sm },
  qTitle: { color: color.text, fontSize: 13.5, fontWeight: '600' },
  qHelp: { color: color.textMuted, fontWeight: '400' },
  jointBlock: {
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  jointRow: { gap: 6 },
  jointName: { color: color.textMuted, fontSize: 12.5 },
  preview: {
    padding: space.md,
    gap: 4,
    borderRadius: radius.chip,
    backgroundColor: color.bgSunken,
  },
  previewLabel: { color: color.textFaint, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  previewText: { color: color.text, fontSize: 13, lineHeight: 19 },
  previewName: { fontWeight: '600' },
  save: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
    backgroundColor: color.accent,
  },
  saveDisabled: { opacity: 0.35 },
  saveText: { color: color.onAccent, fontSize: 13, fontWeight: '600', letterSpacing: 2.4 },
});
