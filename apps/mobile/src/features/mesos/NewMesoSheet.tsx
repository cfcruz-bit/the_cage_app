/**
 * Nuevo mesociclo, en tres pasos.
 *
 * El prototipo tenía una sola pantalla —duración, objetivo y volumen por
 * músculo— porque no creaba nada de verdad. Para crear un mesociclo real hace
 * falta más: a quién, cuántas semanas, y con qué ejercicios. Se reparte en
 * pasos en vez de apilarlo todo, porque un formulario de veinte campos en un
 * teléfono se abandona.
 *
 * El paso 3 es el que nadie puede adivinar por ti: **la carga**. No hay ningún
 * peso inventado -ni un arranque de 20 kg ni ningún otro-, así que la regla la
 * pone el producto:
 *
 * - Un **básico** exige carga en TODAS las semanas, en kilos o en % del 1RM
 *   del atleta: así se programa fuerza. El botón CREAR se apaga mientras
 *   falte alguna.
 * - Un **accesorio** se deja libre: el atleta registra lo primero que levante
 *   y el motor progresa desde ahí, o el coach fija algo luego desde la tabla.
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
  WeekLoadIn,
} from '@/api/types';
import { Chip } from '@/components/Chip';
import { PlanGrid } from '@/features/mesos/PlanGrid';
import { type ParsedLoad, parseLoadInput } from '@/lib/loadInput';
import { groupByMuscle, muscleLabel } from '@/lib/muscles';
import { useRemote } from '@/lib/remote';
import { type Unit, toDisplay } from '@/lib/units';
import { useSession } from '@/stores/session';
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

/**
 * Semanas 1..totalWeeks sin carga (kg o %) todavía, solo para un BÁSICO.
 *
 * Es la misma regla que exige el servidor al crear: un accesorio no exige
 * nada, así que siempre devuelve un array vacío para uno.
 */
function missingWeeksFor(draft: Draft, totalWeeks: number): number[] {
  if (draft.muscle !== 'BASICOS') return [];
  const covered = new Set(
    draft.weeks
      .filter((w) => w.loadKg !== null || w.loadPercent !== null)
      .map((w) => w.weekNumber),
  );
  const missing: number[] = [];
  for (let w = 1; w <= totalWeeks; w += 1) {
    if (!covered.has(w)) missing.push(w);
  }
  return missing;
}

type Step = 1 | 2 | 3;

export function NewMesoSheet({
  visible,
  athletes,
  onClose,
  onCreated,
  onSaved,
}: {
  visible: boolean;
  athletes: UserOut[];
  onClose: () => void;
  /** Se creó (vía CREAR) y el sheet se cierra: hay que refrescar la lista. */
  onCreated: () => void;
  /**
   * Se creó (vía PAUTAR SEMANAS) pero el sheet se queda abierto: solo hay que
   * refrescar la lista de fondo, sin cerrar nada.
   */
  onSaved?: () => void;
}) {
  const catalog = useRemote<ExerciseCatalogOut[]>(
    useCallback(() => listExercises(), []),
    [],
  );
  const unit = useSession((s) => s.unit);

  const [step, setStep] = useState<Step>(1);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [weeks, setWeeks] = useState<number>(6);
  const [aggressiveness, setAggressiveness] = useState<Aggressiveness>('Media');
  const [goal, setGoal] = useState<TrainingGoal>('hipertrofia');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [query, setQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<'crear' | 'pautar' | null>(null);
  const busy = pendingAction !== null;
  const [error, setError] = useState<string | null>(null);
  /** No-null cuando ya se creó y el sheet se queda abierto para pautar. */
  const [createdMesoId, setCreatedMesoId] = useState<string | null>(null);

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
              muscleLabel(e.muscle).toLowerCase().includes(needle) ||
              e.equipment.toLowerCase().includes(needle),
          );

    return groupByMuscle(matching);
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
    setCreatedMesoId(null);
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
          // Sin arranque inventado: null hasta que el paso 3 diga lo
          // contrario. Un básico lo exige por semana; un accesorio se deja
          // libre y el atleta registra lo primero que levante.
          startingLoadKg: null,
          startingReps: Math.round((preset.repLo + preset.repHi) / 2),
          startingSets: preset.sets,
          weeks: [],
        },
      ];
    });
  }

  function patch(catalogId: string, change: Partial<Draft>) {
    setDrafts((current) =>
      current.map((d) => (d.catalogId === catalogId ? { ...d, ...change } : d)),
    );
  }

  /**
   * CREAR cierra el sheet. PAUTAR SEMANAS lo deja abierto y, en cuanto el
   * servidor responde, muestra la tabla del mesociclo recién creado: cerrar
   * después no pierde nada, porque ya está todo guardado (bloque 6).
   */
  async function submit(thenPautar: boolean) {
    if (athleteId === null || drafts.length === 0 || busy) return;

    setPendingAction(thenPautar ? 'pautar' : 'crear');
    setError(null);
    try {
      const meso = await createMesocycle({
        athleteId,
        name: name.trim() || 'Mesociclo',
        totalWeeks: weeks,
        aggressiveness,
        goal,
        exercises: drafts.map(({ name: _n, muscle: _m, ...rest }) => rest),
      });
      if (thenPautar) {
        setCreatedMesoId(meso.id);
        onSaved?.();
      } else {
        reset();
        onCreated();
      }
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.offline
            ? 'Sin conexión con el servidor.'
            : e.message
          : 'No se pudo crear.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  const canAdvance =
    step === 1
      ? athleteId !== null
      : step === 2
        ? drafts.length > 0
        : drafts.every((d) => missingWeeksFor(d, weeks).length === 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.title}>
              {createdMesoId !== null ? 'PAUTAR SEMANAS' : 'NUEVO MESOCICLO'}
            </Text>
            <Text style={styles.subtitle}>
              {createdMesoId !== null
                ? 'Ya está creado. Ajustá lo que quieras; cerrar no pierde nada.'
                : SUBTITLES[step]}
            </Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
            <Ionicons name="close" size={19} color={color.textMuted} />
          </Pressable>
        </View>

        {createdMesoId !== null ? (
          <ScrollView contentContainerStyle={styles.body}>
            <PlanGrid mesocycleId={createdMesoId} />
          </ScrollView>
        ) : (
          <>
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
                Los básicos exigen carga en TODAS las semanas —en kilos o en %
                del 1RM del atleta—, porque así se programa fuerza. Los
                accesorios quedan libres: el atleta registra lo que levante y
                el motor progresa desde ahí, o los fijás luego desde la tabla.
              </Text>

              {drafts.map((d) => {
                const missing = missingWeeksFor(d, weeks);
                const isBasico = d.muscle === 'BASICOS';
                return (
                  <View key={d.catalogId} style={styles.draft}>
                    <Text style={styles.rowName}>{d.name}</Text>
                    <Text style={styles.rowMeta}>
                      {muscleLabel(d.muscle)} · {d.repLo}–{d.repHi} reps · RIR{' '}
                      {d.targetRir}
                    </Text>

                    <View style={styles.fields}>
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

                    {isBasico ? (
                      <>
                        <Text style={styles.weekGridLabel}>
                          CARGA POR SEMANA (% o KG)
                        </Text>
                        <WeekLoadGrid
                          totalWeeks={weeks}
                          weeks={d.weeks}
                          unit={unit}
                          onChange={(next) => patch(d.catalogId, { weeks: next })}
                        />
                        {missing.length > 0 ? (
                          <Text style={styles.error}>
                            Falta la carga de la semana{missing.length > 1 ? 's' : ''}{' '}
                            {missing.join(', ')}.
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <Text style={styles.help}>
                        Sin carga de arranque: es un accesorio.
                      </Text>
                    )}
                  </View>
                );
              })}

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

          {step < 3 ? (
            <Pressable
              onPress={() => setStep((s) => (s + 1) as Step)}
              disabled={!canAdvance}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                !canAdvance && styles.off,
                pressed && canAdvance && styles.primaryPressed,
              ]}
            >
              <Text style={styles.primaryText}>SIGUIENTE</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={() => void submit(false)}
                disabled={!canAdvance || busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.secondary,
                  (!canAdvance || busy) && styles.off,
                  pressed && canAdvance && !busy && { opacity: 0.7 },
                ]}
              >
                {pendingAction === 'crear' ? (
                  <ActivityIndicator color={color.textMuted} />
                ) : (
                  <Text style={styles.secondaryText}>CREAR</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => void submit(true)}
                disabled={!canAdvance || busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primary,
                  (!canAdvance || busy) && styles.off,
                  pressed && canAdvance && !busy && styles.primaryPressed,
                ]}
              >
                {pendingAction === 'pautar' ? (
                  <ActivityIndicator color={color.onAccent} />
                ) : (
                  <Text style={styles.primaryText}>PAUTAR SEMANAS</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
          </>
        )}
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

/**
 * Una fila por semana con un campo de carga que acepta % o kilos.
 *
 * El texto crudo se guarda aparte, igual que en `NumberField`: mientras se
 * escribe "102,5" no hay que perder la coma a cada tecla. Se parsea y se sube
 * al draft al salir del campo, con `parseLoadInput` — el mismo que valida la
 * celda de `PlanGrid.tsx`.
 */
function WeekLoadGrid({
  totalWeeks,
  weeks,
  unit,
  onChange,
}: {
  totalWeeks: number;
  weeks: WeekLoadIn[];
  unit: Unit;
  onChange: (weeks: WeekLoadIn[]) => void;
}) {
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  function textFor(week: number): string {
    const typed = texts[week];
    if (typed !== undefined) return typed;
    const saved = weeks.find((w) => w.weekNumber === week);
    if (saved === undefined) return '';
    if (saved.loadPercent !== null) return `${saved.loadPercent}%`;
    if (saved.loadKg !== null) return String(toDisplay(saved.loadKg, unit));
    return '';
  }

  function commit(week: number) {
    const text = textFor(week);
    const parsed: ParsedLoad = parseLoadInput(text, unit);

    if (parsed.kind === 'invalid') {
      setErrors((current) => ({ ...current, [week]: parsed.reason }));
      return;
    }
    setErrors((current) => {
      const next = { ...current };
      delete next[week];
      return next;
    });

    const rest = weeks.filter((w) => w.weekNumber !== week);
    onChange(
      parsed.kind === 'empty'
        ? rest
        : [
            ...rest,
            {
              weekNumber: week,
              loadKg: parsed.kind === 'kg' ? parsed.value : null,
              loadPercent: parsed.kind === 'percent' ? parsed.value : null,
              sets: null,
              repLo: null,
              repHi: null,
              targetRir: null,
            },
          ],
    );
  }

  return (
    <View style={styles.weekGrid}>
      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => {
        const hasError = errors[week] !== undefined;
        return (
          <View key={week} style={styles.weekCell}>
            <Text style={styles.weekLabel}>S{week}</Text>
            <TextInput
              style={[styles.weekInput, hasError && styles.weekInputError]}
              value={textFor(week)}
              onChangeText={(t) => setTexts((current) => ({ ...current, [week]: t }))}
              onBlur={() => commit(week)}
              placeholder="75% / kg"
              placeholderTextColor={color.textFaint}
              autoCapitalize="none"
              accessibilityLabel={`Carga de la semana ${week}`}
            />
          </View>
        );
      })}
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

  weekGridLabel: {
    color: color.textFaint,
    fontSize: 9.5,
    letterSpacing: 1.4,
    marginTop: space.sm,
  },
  weekGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 4 },
  weekCell: { width: 62, gap: 3 },
  weekLabel: { color: color.textFaint, fontSize: 9.5, textAlign: 'center' },
  weekInput: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: palette.n900,
    color: color.text,
    fontSize: 13,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: radius.chip,
    textAlign: 'center',
  },
  weekInputError: { borderColor: color.accent },

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
