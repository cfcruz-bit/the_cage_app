/**
 * Nuevo mesociclo, en tres pasos.
 *
 * El prototipo tenía una sola pantalla —duración, objetivo y volumen por
 * músculo— porque no creaba nada de verdad. Para crear un mesociclo real hace
 * falta más: a quién, cuántas semanas, y con qué ejercicios. Se reparte en
 * pasos en vez de apilarlo todo, porque un formulario de veinte campos en un
 * teléfono se abandona.
 *
 * El bloque se reparte en **días** (paso 1: cuántos por semana; paso 2: a qué
 * día va cada ejercicio y, si se quiere, cómo se llama cada día). El reparto
 * es fijo para todo el bloque y ningún día puede quedarse sin ejercicios.
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
  MesocycleDayOut,
  MesocycleExerciseIn,
  TrainingGoal,
  UserOut,
  WeekLoadIn,
} from '@/api/types';
import { Chip } from '@/components/Chip';
import { PlanGrid } from '@/features/mesos/PlanGrid';
import { dayHeading, emptyDays, groupByDay } from '@/lib/days';
import { NO_BACKOFF, parseBackoff, parseLoadInput, parseRepsRange } from '@/lib/loadInput';
import { groupByMuscle, muscleLabel } from '@/lib/muscles';
import { useRemote } from '@/lib/remote';
import { type Unit, toDisplay } from '@/lib/units';
import { useSession } from '@/stores/session';
import { color, palette, radius, space } from '@/theme/tokens';

const WEEKS = [4, 5, 6, 8] as const;
const DAYS_PER_WEEK = [1, 2, 3, 4, 5, 6, 7] as const;
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
  const [daysPerWeek, setDaysPerWeek] = useState<number>(1);
  /** Nombre opcional por día. Vacío o ausente = el día se llama "Día N". */
  const [dayNames, setDayNames] = useState<Record<number, string>>({});
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

  /** Solo los días que existen y tienen nombre: es lo que viaja al servidor. */
  const namedDays = useMemo<MesocycleDayOut[]>(
    () =>
      Object.entries(dayNames)
        .map(([n, name]) => ({ dayNumber: Number(n), name: name.trim() }))
        .filter((d) => d.name.length > 0 && d.dayNumber <= daysPerWeek)
        .sort((a, b) => a.dayNumber - b.dayNumber),
    [dayNames, daysPerWeek],
  );

  const daysWithoutExercises = useMemo(
    () =>
      emptyDays(
        daysPerWeek,
        drafts.map((d) => d.dayNumber),
      ),
    [daysPerWeek, drafts],
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
    setDaysPerWeek(1);
    setDayNames({});
    setDrafts([]);
    setQuery('');
    setError(null);
    setCreatedMesoId(null);
  }

  function close() {
    reset();
    onClose();
  }

  /**
   * Cambiar los días por semana no deja ejercicios en un día que ya no existe:
   * los que quedaban más allá pasan al último. Es solo el borrador; el
   * servidor nunca mueve nada por su cuenta.
   */
  function changeDaysPerWeek(n: number) {
    setDaysPerWeek(n);
    setDrafts((current) =>
      current.map((d) => (d.dayNumber > n ? { ...d, dayNumber: n } : d)),
    );
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
          dayNumber: 1,
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
        daysPerWeek,
        days: namedDays,
        // Orden estable por día: la posición dentro de cada día es el orden
        // en que se eligieron.
        exercises: [...drafts]
          .sort((a, b) => a.dayNumber - b.dayNumber)
          .map(({ name: _n, muscle: _m, ...rest }) => rest),
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

  /**
   * Que basicos siguen sin carga, para poder decirlo PEGADO a los botones.
   *
   * El aviso por ejercicio ya existe, pero vive dentro de su tarjeta: con seis
   * ejercicios queda a varias pantallas de scroll del pie, y desde abajo lo
   * unico que se ve es un boton apagado sin explicacion. Un boton que no se
   * deja pulsar y no dice por que se lee como una app rota.
   */
  const pendientes = useMemo(
    () =>
      drafts
        .map((d) => ({ name: d.name, missing: missingWeeksFor(d, weeks) }))
        .filter((p) => p.missing.length > 0),
    [drafts, weeks],
  );

  const canAdvance =
    step === 1
      ? athleteId !== null
      : step === 2
        ? drafts.length > 0 && daysWithoutExercises.length === 0
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

              <Text style={styles.label}>DÍAS POR SEMANA</Text>
              <View style={styles.chips}>
                {DAYS_PER_WEEK.map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    active={daysPerWeek === n}
                    onPress={() => changeDaysPerWeek(n)}
                  />
                ))}
              </View>
              <Text style={styles.help}>
                El reparto de ejercicios entre los días es fijo para todo el bloque.
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
              <Text style={styles.label}>NOMBRE DE CADA DÍA (OPCIONAL)</Text>
              {Array.from({ length: daysPerWeek }, (_, i) => i + 1).map((n) => (
                <View key={n} style={styles.dayNameRow}>
                  <Text style={styles.dayNameLabel}>Día {n} ·</Text>
                  <TextInput
                    style={[styles.input, styles.dayNameInput]}
                    value={dayNames[n] ?? ''}
                    onChangeText={(t) => setDayNames((cur) => ({ ...cur, [n]: t }))}
                    placeholder="Empuje, Pierna..."
                    placeholderTextColor={color.textFaint}
                    maxLength={40}
                    accessibilityLabel={`Nombre del día ${n}`}
                  />
                </View>
              ))}

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
              {daysWithoutExercises.length > 0 ? (
                <Text style={styles.error}>
                  {daysWithoutExercises.length === 1 ? 'El día' : 'Los días'}{' '}
                  {daysWithoutExercises.join(', ')} se queda
                  {daysWithoutExercises.length === 1 ? '' : 'n'} sin ejercicios. Asigna
                  al menos uno a cada día.
                </Text>
              ) : null}

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
                    const draft = drafts.find((d) => d.catalogId === item.id);
                    return (
                      <View key={item.id} style={styles.pick}>
                      <Pressable
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
                      {on && draft !== undefined && daysPerWeek > 1 ? (
                        <View style={styles.dayChips}>
                          {Array.from({ length: daysPerWeek }, (_, i) => i + 1).map((n) => (
                            <Chip
                              key={n}
                              label={`D${n}`}
                              active={draft.dayNumber === n}
                              onPress={() => patch(item.id, { dayNumber: n })}
                            />
                          ))}
                        </View>
                      ) : null}
                      </View>
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

              {groupByDay(drafts).map((group) => (
                <View key={group.dayNumber} style={styles.dayGroup}>
                  <Text style={styles.groupTitle}>
                    {dayHeading(group.dayNumber, namedDays)}
                  </Text>
                  {group.items.map((d) => {
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
                          SEMANA A SEMANA · carga obligatoria (% o KG)
                        </Text>
                        <WeekPlanGrid
                          totalWeeks={weeks}
                          weeks={d.weeks}
                          unit={unit}
                          defaultSets={d.startingSets}
                          defaultReps={`${d.repLo}-${d.repHi}`}
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
                </View>
              ))}

              {error !== null ? <Text style={styles.error}>{error}</Text> : null}
            </>
          ) : null}
        </ScrollView>

        {step === 3 && pendientes.length > 0 ? (
          <View style={styles.blocker}>
            <Text style={styles.blockerTitle}>
              Falta carga para poder crear el mesociclo
            </Text>
            {pendientes.map((p) => (
              <Text key={p.name} style={styles.blockerItem}>
                {p.name} · semana{p.missing.length > 1 ? 's' : ''}{' '}
                {p.missing.join(', ')}
              </Text>
            ))}
            <Text style={styles.blockerHelp}>
              Los básicos llevan carga en todas las semanas. Escribe un
              porcentaje (75%) o kilos (102.5) en cada casilla.
            </Text>
          </View>
        ) : null}

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

type WeekField = 'sets' | 'reps' | 'load' | 'bSets' | 'bReps' | 'bLoad';

/**
 * Una fila por semana de un básico: sets × reps @ carga, y un back-off
 * opcional debajo. Vacío en sets o reps = los de arriba del ejercicio; la
 * carga es obligatoria (la exige el servidor).
 *
 * El texto crudo se guarda aparte, igual que en `NumberField`: mientras se
 * escribe "102,5" no hay que perder la coma a cada tecla. Se parsea y se sube
 * al draft al salir de cualquier campo de la semana.
 */
function WeekPlanGrid({
  totalWeeks,
  weeks,
  unit,
  defaultSets,
  defaultReps,
  onChange,
}: {
  totalWeeks: number;
  weeks: WeekLoadIn[];
  unit: Unit;
  defaultSets: number;
  defaultReps: string;
  onChange: (weeks: WeekLoadIn[]) => void;
}) {
  const [texts, setTexts] = useState<Record<number, Partial<Record<WeekField, string>>>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [withBackoff, setWithBackoff] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(
      weeks.filter((w) => w.backoffSets !== null).map((w) => [w.weekNumber, true]),
    ),
  );

  function loadText(kg: number | null, pct: number | null): string {
    if (pct !== null) return `${pct}%`;
    if (kg !== null) return String(toDisplay(kg, unit));
    return '';
  }

  function textFor(week: number, field: WeekField): string {
    const typed = texts[week]?.[field];
    if (typed !== undefined) return typed;
    const w = weeks.find((x) => x.weekNumber === week);
    if (w === undefined) return '';
    switch (field) {
      case 'sets':
        return w.sets === null ? '' : String(w.sets);
      case 'reps':
        if (w.repLo === null) return '';
        return w.repLo === w.repHi ? String(w.repLo) : `${w.repLo}-${w.repHi}`;
      case 'load':
        return loadText(w.loadKg, w.loadPercent);
      case 'bSets':
        return w.backoffSets === null ? '' : String(w.backoffSets);
      case 'bReps':
        return w.backoffReps === null ? '' : String(w.backoffReps);
      case 'bLoad':
        return loadText(w.backoffLoadKg, w.backoffLoadPercent);
    }
  }

  function commit(week: number) {
    const t = (f: WeekField) => textFor(week, f);
    const fail = (reason: string) => setErrors((c) => ({ ...c, [week]: reason }));

    const setsText = t('sets').trim();
    const sets = setsText === '' ? null : Number(setsText);
    if (sets !== null && !(Number.isInteger(sets) && sets >= 1 && sets <= 20)) {
      return fail('Los sets van de 1 a 20.');
    }
    const repsText = t('reps').trim();
    const reps = repsText === '' ? null : parseRepsRange(repsText);
    if (repsText !== '' && reps === null) {
      return fail('Reps: un número (5) o un rango (3-5).');
    }
    const load = parseLoadInput(t('load'), unit);
    if (load.kind === 'invalid') return fail(load.reason);
    const backoff = parseBackoff(t('bSets'), t('bReps'), t('bLoad'), unit);
    if ('error' in backoff) return fail(backoff.error);

    setErrors((c) => {
      const next = { ...c };
      delete next[week];
      return next;
    });

    const entry: WeekLoadIn = {
      weekNumber: week,
      sets,
      repLo: reps?.lo ?? null,
      repHi: reps?.hi ?? null,
      targetRir: null,
      loadKg: load.kind === 'kg' ? load.value : null,
      loadPercent: load.kind === 'percent' ? load.value : null,
      ...backoff,
    };
    const empty =
      sets === null && reps === null && load.kind === 'empty' && backoff.backoffSets === null;
    const rest = weeks.filter((w) => w.weekNumber !== week);
    onChange(empty ? rest : [...rest, entry]);
  }

  function input(week: number, field: WeekField, placeholder: string, label: string) {
    return (
      <TextInput
        style={[styles.weekInput, errors[week] !== undefined && styles.weekInputError]}
        value={textFor(week, field)}
        onChangeText={(v) => setTexts((c) => ({ ...c, [week]: { ...c[week], [field]: v } }))}
        onBlur={() => commit(week)}
        placeholder={placeholder}
        placeholderTextColor={color.textFaint}
        autoCapitalize="none"
        accessibilityLabel={`${label} de la semana ${week}`}
      />
    );
  }

  function removeBackoff(week: number) {
    setWithBackoff((c) => ({ ...c, [week]: false }));
    setTexts((c) => ({ ...c, [week]: { ...c[week], bSets: '', bReps: '', bLoad: '' } }));
    onChange(weeks.map((w) => (w.weekNumber === week ? { ...w, ...NO_BACKOFF } : w)));
  }

  return (
    <View style={styles.weekList}>
      <View style={styles.weekRow}>
        <View style={styles.weekLabelBox} />
        <Text style={styles.weekHead}>SETS</Text>
        <Text style={styles.weekHead}>REPS</Text>
        <Text style={[styles.weekHead, styles.weekLoad]}>CARGA</Text>
      </View>
      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => (
        <View key={week} style={styles.weekBlock}>
          <View style={styles.weekRow}>
            <View style={styles.weekLabelBox}>
              <Text style={styles.weekLabel}>S{week}</Text>
            </View>
            <View style={styles.weekCol}>{input(week, 'sets', String(defaultSets), 'Sets')}</View>
            <View style={styles.weekCol}>{input(week, 'reps', defaultReps, 'Reps')}</View>
            <View style={[styles.weekCol, styles.weekLoad]}>
              {input(week, 'load', '75% / kg', 'Carga')}
            </View>
          </View>

          {withBackoff[week] ? (
            <View style={styles.weekRow}>
              <Pressable
                onPress={() => removeBackoff(week)}
                accessibilityRole="button"
                accessibilityLabel={`Quitar back-off de la semana ${week}`}
                hitSlop={6}
                style={styles.weekLabelBox}
              >
                <Text style={styles.backoffTag}>B-O</Text>
                <Ionicons name="close" size={11} color={color.accent} />
              </Pressable>
              <View style={styles.weekCol}>
                {input(week, 'bSets', '3', 'Sets de back-off')}
              </View>
              <View style={styles.weekCol}>
                {input(week, 'bReps', '5', 'Reps de back-off')}
              </View>
              <View style={[styles.weekCol, styles.weekLoad]}>
                {input(week, 'bLoad', '70% / kg', 'Carga de back-off')}
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setWithBackoff((c) => ({ ...c, [week]: true }))}
              accessibilityRole="button"
              accessibilityLabel={`Añadir back-off a la semana ${week}`}
              hitSlop={4}
            >
              <Text style={styles.addBackoff}>+ back-off</Text>
            </Pressable>
          )}

          {errors[week] !== undefined ? (
            <Text style={styles.weekError}>{errors[week]}</Text>
          ) : null}
        </View>
      ))}
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

  dayNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dayNameLabel: { color: color.textMuted, fontSize: 13, width: 58 },
  dayNameInput: { flex: 1, paddingVertical: 8 },
  pick: { gap: 5 },
  dayChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 29 },
  dayGroup: { gap: space.sm, marginTop: space.sm },
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
  weekList: { gap: space.sm, marginTop: 4 },
  weekBlock: { gap: 4 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekCol: { flex: 1 },
  weekLoad: { flex: 1.6 },
  weekLabelBox: { width: 38, flexDirection: 'row', alignItems: 'center', gap: 2 },
  weekLabel: { color: color.textFaint, fontSize: 10.5 },
  weekHead: {
    flex: 1,
    color: color.textFaint,
    fontSize: 9,
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  backoffTag: { color: color.accent, fontSize: 9.5, letterSpacing: 0.5 },
  addBackoff: { color: color.accent, fontSize: 11.5, paddingLeft: 44, paddingVertical: 2 },
  weekError: { color: color.accent, fontSize: 11.5, paddingLeft: 44 },
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

  blocker: {
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: 2,
  },
  blockerTitle: {
    color: color.accent,
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  blockerItem: { color: color.accent, fontSize: 12.5, lineHeight: 18 },
  blockerHelp: {
    color: color.textFaint,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 2,
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
