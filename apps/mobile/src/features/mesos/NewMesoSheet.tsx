/**
 * Nuevo mesociclo, en tres pasos.
 *
 * El prototipo tenía una sola pantalla —duración, objetivo y volumen por
 * músculo— porque no creaba nada de verdad. Para crear un mesociclo real hace
 * falta más: a quién, cuántas semanas, y con qué ejercicios y cargas de
 * arranque. Se reparte en pasos en vez de apilarlo todo, porque un formulario
 * de veinte campos en un teléfono se abandona.
 *
 * El paso 3 es el que importa y el que nadie puede adivinar por ti: **la carga
 * de arranque**. El motor necesita siempre un "la vez anterior" para calcular,
 * y en la semana 1 no lo hay. Ese número sale del test de cargas iniciales que
 * el coach hace con el atleta, y de ahí en adelante ya progresa solo.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Aggressiveness } from '@cage/engine';

import { ApiError } from '@/api/client';
import { createMesocycle, listExercises } from '@/api/endpoints';
import type {
  ExerciseCatalogOut,
  MesocycleExerciseIn,
  TrainingGoal,
  UserOut,
} from '@/api/types';
import { Chip } from '@/components/Chip';
import { useRemote } from '@/lib/remote';
import { color, palette, radius, space } from '@/theme/tokens';

const WEEKS = [4, 5, 6, 8] as const;
const AGGRESSIVENESS: Aggressiveness[] = ['Baja', 'Media', 'Alta'];

const GOALS: TrainingGoal[] = ['fuerza', 'hipertrofia', 'hibrido'];

const GOAL_LABEL: Record<TrainingGoal, string> = {
  fuerza: 'Fuerza',
  hipertrofia: 'Hipertrofia',
  hibrido: 'Híbrido',
};

/**
 * Con qué valores entra cada ejercicio según el objetivo.
 *
 * No cambian cómo calcula el motor: son el punto de partida, y el coach los
 * retoca por ejercicio si quiere. Un press de banca en fuerza y en hipertrofia
 * es el mismo ejercicio; lo que cambia es cómo se entrena.
 */
interface GoalPreset {
  repLo: number;
  repHi: number;
  targetRir: number;
  sets: number;
  help: string;
}

/**
 * Los músculos en orden de pantalla.
 *
 * No alfabético: de arriba abajo del cuerpo, que es como un coach recorre un
 * plan y como estaba ordenado el prototipo.
 */
const MUSCLE_ORDER = [
  'CHEST',
  'BACK',
  'SHOULDERS',
  'BICEPS',
  'TRICEPS',
  'QUADS',
  'HAMSTRINGS',
  'GLUTES',
  'CALVES',
  'ABS',
] as const;

const MUSCLE_LABEL: Record<string, string> = {
  CHEST: 'Pecho',
  BACK: 'Espalda',
  SHOULDERS: 'Hombros',
  BICEPS: 'Bíceps',
  TRICEPS: 'Tríceps',
  QUADS: 'Cuádriceps',
  HAMSTRINGS: 'Isquiotibiales',
  GLUTES: 'Glúteos',
  CALVES: 'Gemelos',
  ABS: 'Abdomen',
};

const GOAL_PRESET: Record<TrainingGoal, GoalPreset> = {
  fuerza: {
    repLo: 3,
    repHi: 6,
    targetRir: 3,
    sets: 4,
    help: '3–6 reps con RIR 3 y series pesadas. Más margen al fallo porque el riesgo técnico sube con la carga.',
  },
  hipertrofia: {
    repLo: 8,
    repHi: 15,
    targetRir: 1,
    sets: 3,
    help: '8–15 reps con RIR 1. Cerca del fallo y con más volumen acumulado.',
  },
  hibrido: {
    repLo: 6,
    repHi: 10,
    targetRir: 2,
    sets: 3,
    help: '6–10 reps con RIR 2. El punto medio: carga suficiente y volumen suficiente.',
  },
};

const AGGRESSIVENESS_HELP: Record<Aggressiveness, string> = {
  Baja: 'Sube la carga a la mitad de ritmo.',
  Media: 'Un escalón por cada señal de progresión.',
  Alta: 'Multiplica los saltos por 1.5.',
};

/** Un ejercicio ya elegido, con lo que el coach puede ajustar. */
interface Draft extends MesocycleExerciseIn {
  name: string;
  muscle: string;
}

type Step = 1 | 2 | 3;

export function NewMesoSheet({
  visible,
  athletes,
  onClose,
  onCreated,
}: {
  visible: boolean;
  athletes: UserOut[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const catalog = useRemote<ExerciseCatalogOut[]>(
    useCallback(() => listExercises(), []),
    [],
  );

  const [step, setStep] = useState<Step>(1);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [weeks, setWeeks] = useState<number>(6);
  const [aggressiveness, setAggressiveness] = useState<Aggressiveness>('Media');
  const [goal, setGoal] = useState<TrainingGoal>('hipertrofia');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(
    () => new Set(drafts.map((d) => d.catalogId)),
    [drafts],
  );

  /**
   * El catálogo por grupos musculares, en orden de pantalla.
   *
   * Agrupar y no listar en plano es lo que convierte cincuenta ejercicios en
   * algo navegable: un coach piensa "hoy toca espalda", no "hoy toca el
   * ejercicio número treinta y uno".
   *
   * Los músculos sin ningún ejercicio no se pintan, y al buscar desaparecen
   * los grupos que no tienen coincidencias: una cabecera vacía es ruido.
   */
  const grouped = useMemo(() => {
    const items = catalog.data ?? [];
    const needle = query.trim().toLowerCase();

    const matching =
      needle.length === 0
        ? items
        : items.filter(
            (e) =>
              e.name.toLowerCase().includes(needle) ||
              (MUSCLE_LABEL[e.muscle] ?? e.muscle).toLowerCase().includes(needle) ||
              e.equipment.toLowerCase().includes(needle),
          );

    const byMuscle = new Map<string, ExerciseCatalogOut[]>();
    for (const item of matching) {
      const bucket = byMuscle.get(item.muscle);
      if (bucket === undefined) byMuscle.set(item.muscle, [item]);
      else bucket.push(item);
    }

    const known = MUSCLE_ORDER.filter((m) => byMuscle.has(m));
    // Un músculo que el servidor conozca y esta app no, al final en vez de
    // desaparecido: un ejercicio invisible es peor que uno mal ordenado.
    const unknown = [...byMuscle.keys()]
      .filter((m) => !MUSCLE_ORDER.includes(m as (typeof MUSCLE_ORDER)[number]))
      .sort();

    return [...known, ...unknown].map((muscle) => ({
      muscle,
      label: MUSCLE_LABEL[muscle] ?? muscle,
      items: byMuscle.get(muscle) ?? [],
    }));
  }, [catalog.data, query]);

  const totalVisible = useMemo(
    () => grouped.reduce((n, g) => n + g.items.length, 0),
    [grouped],
  );

  function reset() {
    setStep(1);
    setAthleteId(null);
    setName('');
    setWeeks(6);
    setAggressiveness('Media');
    setGoal('hipertrofia');
    setDrafts([]);
    setQuery('');
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function toggle(item: ExerciseCatalogOut) {
    setDrafts((current) => {
      if (current.some((d) => d.catalogId === item.id)) {
        return current.filter((d) => d.catalogId !== item.id);
      }
      const preset = GOAL_PRESET[goal];
      return [
        ...current,
        {
          catalogId: item.id,
          name: item.name,
          muscle: item.muscle,
          // Del objetivo, no del catálogo: el mismo ejercicio se entrena
          // distinto según lo que se busque.
          repLo: preset.repLo,
          repHi: preset.repHi,
          targetRir: preset.targetRir,
          loadIncrementKg: item.loadIncrementKg,
          // Arranque neutro. El coach lo corrige en el paso 3; es el único
          // número que no se puede deducir de nada.
          startingLoadKg: 20,
          startingReps: Math.round((preset.repLo + preset.repHi) / 2),
          startingSets: preset.sets,
        },
      ];
    });
  }

  function patch(catalogId: string, change: Partial<Draft>) {
    setDrafts((current) =>
      current.map((d) => (d.catalogId === catalogId ? { ...d, ...change } : d)),
    );
  }

  async function submit() {
    if (athleteId === null || drafts.length === 0 || busy) return;

    setBusy(true);
    setError(null);
    try {
      await createMesocycle({
        athleteId,
        name: name.trim() || 'Mesociclo',
        totalWeeks: weeks,
        aggressiveness,
        goal,
        exercises: drafts.map(({ name: _n, muscle: _m, ...rest }) => rest),
      });
      reset();
      onCreated();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.offline
            ? 'Sin conexión con el servidor.'
            : e.message
          : 'No se pudo crear.',
      );
    } finally {
      setBusy(false);
    }
  }

  const canAdvance =
    step === 1 ? athleteId !== null : step === 2 ? drafts.length > 0 : true;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.title}>NUEVO MESOCICLO</Text>
            <Text style={styles.subtitle}>{SUBTITLES[step]}</Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
            <Ionicons name="close" size={19} color={color.textMuted} />
          </Pressable>
        </View>

        <View style={styles.steps}>
          {[1, 2, 3].map((n) => (
            <View key={n} style={[styles.stepDot, n <= step && styles.stepDotOn]} />
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {step === 1 ? (
            <>
              <Text style={styles.label}>ATLETA</Text>
              {athletes.length === 0 ? (
                <Text style={styles.help}>
                  Todavía no llevas a nadie. Pídele al administrador que te
                  asigne atletas.
                </Text>
              ) : (
                <View style={styles.chips}>
                  {athletes.map((a) => (
                    <Chip
                      key={a.id}
                      label={a.displayName}
                      active={athleteId === a.id}
                      onPress={() => setAthleteId(a.id)}
                    />
                  ))}
                </View>
              )}

              <Text style={styles.label}>NOMBRE</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Push/Pull/Legs"
                placeholderTextColor={color.textFaint}
                accessibilityLabel="Nombre del mesociclo"
              />

              <Text style={styles.label}>OBJETIVO</Text>
              <View style={styles.chips}>
                {GOALS.map((g) => (
                  <Chip
                    key={g}
                    label={GOAL_LABEL[g]}
                    active={goal === g}
                    onPress={() => setGoal(g)}
                  />
                ))}
              </View>
              <Text style={styles.help}>{GOAL_PRESET[goal].help}</Text>

              <Text style={styles.label}>DURACIÓN</Text>
              <View style={styles.chips}>
                {WEEKS.map((w) => (
                  <Chip
                    key={w}
                    label={`${w} sem`}
                    active={weeks === w}
                    onPress={() => setWeeks(w)}
                  />
                ))}
              </View>
              <Text style={styles.help}>
                La última semana es el deload: el motor baja la carga al 75% y
                recorta el volumen.
              </Text>

              <Text style={styles.label}>AGRESIVIDAD</Text>
              <View style={styles.chips}>
                {AGGRESSIVENESS.map((a) => (
                  <Chip
                    key={a}
                    label={a}
                    active={aggressiveness === a}
                    onPress={() => setAggressiveness(a)}
                  />
                ))}
              </View>
              <Text style={styles.help}>{AGGRESSIVENESS_HELP[aggressiveness]}</Text>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar ejercicio o músculo"
                placeholderTextColor={color.textFaint}
                autoCorrect={false}
                accessibilityLabel="Buscar ejercicio"
              />
              <Text style={styles.help}>
                {drafts.length === 0
                  ? 'Elegí los ejercicios del bloque.'
                  : `${drafts.length} elegidos.`}
              </Text>

              {catalog.loading && catalog.data === null ? (
                <ActivityIndicator color={color.accent} style={{ marginTop: space.lg }} />
              ) : null}

              {catalog.data !== null && totalVisible === 0 ? (
                <Text style={styles.help}>Nada coincide con esa búsqueda.</Text>
              ) : null}

              {grouped.map((group) => (
                <View key={group.muscle} style={styles.group}>
                  <View style={styles.groupHead}>
                    <Text style={styles.groupTitle}>{group.label.toUpperCase()}</Text>
                    <Text style={styles.groupCount}>{group.items.length}</Text>
                  </View>

                  {group.items.map((item) => {
                    const on = chosen.has(item.id);
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => toggle(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`${on ? 'Quitar' : 'Añadir'} ${item.name}`}
                        style={({ pressed }) => [
                          styles.row,
                          on && styles.rowOn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Ionicons
                          name={on ? 'checkbox' : 'square-outline'}
                          size={18}
                          color={on ? color.accent : color.textFaint}
                        />
                        <View style={styles.rowText}>
                          <Text style={styles.rowName}>{item.name}</Text>
                          <Text style={styles.rowMeta}>{item.equipment}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Text style={styles.help}>
                La carga de arranque es la de la semana 1. El motor la necesita
                para tener un punto de partida; a partir de ahí progresa con el
                RIR y el feedback del atleta.
              </Text>

              {drafts.map((d) => (
                <View key={d.catalogId} style={styles.draft}>
                  <Text style={styles.rowName}>{d.name}</Text>
                  <Text style={styles.rowMeta}>
                    {d.muscle} · {d.repLo}–{d.repHi} reps · RIR {d.targetRir}
                  </Text>

                  <View style={styles.fields}>
                    <NumberField
                      label="CARGA KG"
                      value={d.startingLoadKg}
                      onChange={(v) => patch(d.catalogId, { startingLoadKg: v })}
                    />
                    <NumberField
                      label="REPS"
                      value={d.startingReps}
                      onChange={(v) => patch(d.catalogId, { startingReps: v })}
                    />
                    <NumberField
                      label="SETS"
                      value={d.startingSets}
                      onChange={(v) => patch(d.catalogId, { startingSets: v })}
                    />
                  </View>
                </View>
              ))}

              {error !== null ? <Text style={styles.error}>{error}</Text> : null}
            </>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {step > 1 ? (
            <Pressable
              onPress={() => setStep((s) => (s - 1) as Step)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.secondaryText}>Atrás</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => {
              if (step < 3) setStep((s) => (s + 1) as Step);
              else void submit();
            }}
            disabled={!canAdvance || busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primary,
              (!canAdvance || busy) && styles.off,
              pressed && canAdvance && !busy && styles.primaryPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={color.onAccent} />
            ) : (
              <Text style={styles.primaryText}>
                {step < 3 ? 'SIGUIENTE' : 'CREAR'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const SUBTITLES: Record<Step, string> = {
  1: 'Atleta, duración y ritmo',
  2: 'Ejercicios del bloque',
  3: 'Cargas de arranque',
};

/**
 * Campo numérico.
 *
 * Guarda el texto crudo mientras se escribe: si se convirtiera a número en
 * cada tecla, borrar el último dígito dejaría un 0 pegado y habría que
 * seleccionarlo a mano. Al salir del campo se normaliza.
 */
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={text}
        onChangeText={setText}
        onBlur={() => {
          const parsed = Number(text.replace(',', '.'));
          const next = Number.isFinite(parsed) && parsed > 0 ? parsed : value;
          setText(String(next));
          onChange(next);
        }}
        keyboardType="numeric"
        selectTextOnFocus
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: color.bgRaised,
    borderTopWidth: 1,
    borderTopColor: color.border,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: space.lg,
    paddingBottom: space.sm,
  },
  headText: { flex: 1, gap: 2 },
  title: { color: color.text, fontSize: 16, fontWeight: '600', letterSpacing: 2.6 },
  subtitle: { color: color.textMuted, fontSize: 12.5 },

  steps: { flexDirection: 'row', gap: 5, paddingHorizontal: space.lg },
  stepDot: { flex: 1, height: 2, backgroundColor: color.border },
  stepDotOn: { backgroundColor: color.accent },

  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  label: {
    color: color.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    marginTop: space.sm,
  },
  help: { color: color.textFaint, fontSize: 12, lineHeight: 17 },
  error: { color: color.accent, fontSize: 12.5, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: palette.n900,
    color: color.text,
    fontSize: 15,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: radius.chip,
  },

  group: { gap: 5, marginTop: space.sm },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  groupTitle: { color: color.accent, fontSize: 10, letterSpacing: 2 },
  groupCount: { color: color.textFaint, fontSize: 10.5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
  },
  rowOn: { borderColor: color.accent, backgroundColor: color.rowHighlight },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: color.text, fontSize: 14, fontWeight: '500' },
  rowMeta: { color: color.textMuted, fontSize: 11.5 },

  draft: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    padding: 12,
    gap: 3,
  },
  fields: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  field: { flex: 1, gap: 4 },
  fieldLabel: { color: color.textFaint, fontSize: 9.5, letterSpacing: 1.4 },
  fieldInput: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: palette.n900,
    color: color.text,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: radius.chip,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  footer: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.lg,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  primary: {
    flex: 2,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.chip,
  },
  primaryPressed: { backgroundColor: palette.accentEdge },
  off: { opacity: 0.4 },
  primaryText: {
    color: color.onAccent,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2.4,
  },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.chip,
  },
  secondaryText: { color: color.textMuted, fontSize: 13, fontWeight: '500' },
});
