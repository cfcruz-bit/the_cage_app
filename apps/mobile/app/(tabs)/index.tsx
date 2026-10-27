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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { Soreness } from '@cage/engine';

import type { SessionOut } from '@/api/types';
import { Screen } from '@/components/Screen';
import { DeviationSheet } from '@/features/workout/DeviationSheet';
import { MuscleFeedback, SorenessAsk } from '@/features/feedback/MuscleFeedback';
import { FocusSet } from '@/features/workout/FocusSet';
import { LoadedBar } from '@/features/workout/LoadedBar';
import { RestTimer } from '@/features/workout/RestTimer';
import { SessionExerciseCard } from '@/features/workout/SessionExerciseCard';
import { GenerateSessionSheet } from '@/features/workout/GenerateSessionSheet';
import { type HistoryTarget, HistorySheet } from '@/features/workout/HistorySheet';
import { nextUpText } from '@/lib/days';
import { muscleLabel } from '@/lib/muscles';
import { joinParts, techniqueOf } from '@/lib/technique';
import { warmupSets } from '@/lib/warmup';
import { useApp } from '@/stores/app';
import { useSession } from '@/stores/session';
import { useSync } from '@/stores/sync';
import { resolveSet, useWorkout } from '@/stores/workout';
import { color, condensed, radius, space } from '@/theme/tokens';
import { formatLoad, formatNumber } from '@/lib/units';

const KEEP_AWAKE_TAG = 'sesion';
/** Un toque corto: confirma el set sin que haga falta mirar la pantalla. */
const TAP_MS = 30;

export default function WorkoutScreen() {
  const isCoach = useApp((s) => s.role) === 'coach';

  const session = useWorkout((s) => s.session);
  const loading = useWorkout((s) => s.loading);
  const stale = useWorkout((s) => s.stale);
  const error = useWorkout((s) => s.error);
  const marks = useWorkout((s) => s.marks);
  const feedbackDone = useWorkout((s) => s.feedbackDone);
  const load = useWorkout((s) => s.load);
  const next = useWorkout((s) => s.next);
  const finished = useWorkout((s) => s.finished);
  const openNext = useWorkout((s) => s.openNext);
  const toggleSet = useWorkout((s) => s.toggleSet);
  const reportSet = useWorkout((s) => s.reportSet);
  const saveFeedback = useWorkout((s) => s.saveFeedback);

  const unit = useSession((s) => s.unit);
  const pending = useSync((s) => s.pending);

  const [rest, setRest] = useState<{ seconds: number; key: string } | null>(null);
  /** Agujetas contestadas al empezar cada músculo, por grupo. Solo de esta sesión. */
  const [soreness, setSoreness] = useState<Record<string, Soreness>>({});
  const [deviation, setDeviation] = useState<{
    exerciseId: string;
    index: number;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [historyFor, setHistoryFor] = useState<HistoryTarget | null>(null);
  /** Ejercicio con el panel de la técnica de su último set abierto. */
  const [techniqueFor, setTechniqueFor] = useState<string | null>(null);
  /** Aproximaciones hechas por ejercicio. Solo en memoria: no son trabajo que contar. */
  const [warmDone, setWarmDone] = useState<Record<string, number>>({});

  useEffect(() => {
    void load();
  }, [load]);

  // Entre series el móvil está en el suelo: con una sesión abierta la pantalla
  // no se apaga. Solo en esta pestaña; al salir de ella vuelve a lo normal.
  const sessionOpen = session !== null;
  useEffect(() => {
    if (!sessionOpen) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [sessionOpen]);

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
        backoff: s.backoff,
        ...resolveSet(marks, exercise.id, s.index, {
          done: s.done,
          loggedWeightKg: s.loggedWeightKg,
          loggedReps: s.loggedReps,
          loggedSubSets: s.loggedSubSets ?? null,
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
        Vibration.vibrate(TAP_MS);
        setRest({ seconds: restSeconds, key: `${exerciseId}:${index}` });
      },
    [toggleSet],
  );

  // La lista sigue al ejercicio en curso: al terminar uno, el siguiente sube
  // solo bajo el bloque del set activo.
  const listRef = useRef<ScrollView>(null);
  const cardY = useRef<Record<string, number>>({});
  const focusId = summary.firstPending?.exerciseId ?? null;
  const scrollToCard = useCallback((y: number, animated: boolean) => {
    listRef.current?.scrollTo({ y: Math.max(0, y - space.sm), animated });
  }, []);
  useEffect(() => {
    const y = focusId === null ? undefined : cardY.current[focusId];
    if (y !== undefined) scrollToCard(y, true);
  }, [focusId, scrollToCard]);

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
          {!isCoach && next !== null ? (
            // El atleta no elige qué entrenar: el servidor le dice qué día toca.
            <>
              <Ionicons name="barbell-outline" size={30} color={color.accent} />
              <Text style={styles.emptyTitle}>{nextUpText(next)}</Text>
              <Text style={styles.emptyBody}>
                {error ?? 'Es tu siguiente día del bloque.'}
              </Text>
              <Pressable
                onPress={() => void openNext()}
                disabled={loading}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.action,
                  loading && { opacity: 0.5 },
                  pressed && !loading && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.actionText}>EMPEZAR</Text>
              </Pressable>
            </>
          ) : !isCoach && finished ? (
            <>
              <Ionicons name="trophy-outline" size={30} color={color.accent} />
              <Text style={styles.emptyTitle}>Bloque completado</Text>
              <Text style={styles.emptyBody}>
                Hiciste todos los días de tu bloque. Tu coach te prepara el siguiente.
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="barbell-outline" size={30} color={color.textFaint} />
              <Text style={styles.emptyTitle}>
                {error ?? 'Nada programado todavía'}
              </Text>
              <Text style={styles.emptyBody}>
                {isCoach
                  ? 'Genera la sesión del día para tu atleta desde un bloque activo.'
                  : 'Todavía no tienes un bloque activo. En cuanto tu coach lo cree, aparece aquí.'}
              </Text>
            </>
          )}

          {isCoach ? (
            <Pressable
              onPress={() => setGenerating(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.actionText}>GENERAR SESIÓN</Text>
            </Pressable>
          ) : next === null && !finished ? (
            <Pressable
              onPress={() => void load()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.emptyBody}>Comprobar de nuevo</Text>
            </Pressable>
          ) : null}
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

  // El feedback va por músculo (el grupo del catálogo): el primer ejercicio de
  // cada uno pregunta las agujetas y, con todo el grupo hecho, una tarjeta tras
  // el último pregunta el pump, la carga y las articulaciones.
  const groups = new Map<string, typeof resolved>();
  for (const r of resolved) {
    const g = groups.get(r.exercise.muscle);
    if (g === undefined) groups.set(r.exercise.muscle, [r]);
    else g.push(r);
  }
  const groupFeedback = (muscle: string) =>
    (groups.get(muscle) ?? []).every((r) => feedbackDone[r.exercise.id] === true);

  // El RIR va en la cabecera solo si es el mismo en todo el día; si el coach
  // pautó RIR distintos, cada ejercicio ya lo lleva en su línea.
  const rirs = new Set(session.exercises.map((e) => e.targetRir).filter((r) => r != null));
  const dayRir = rirs.size === 1 ? [...rirs][0] : null;

  /** El set que toca: lo que ocupa la parte de arriba de la pantalla. */
  const focus = (() => {
    const fp = summary.firstPending;
    if (fp === null) return null;
    const row = resolved.find((r) => r.exercise.id === fp.exerciseId);
    const set = row?.sets.find((x) => x.index === fp.index);
    if (row === undefined || set === undefined) return null;
    return {
      exercise: row.exercise,
      set,
      setCount: row.sets.length,
      // El último set con técnica no se marca de un toque: abre sus partes.
      technique:
        techniqueOf(row.exercise) !== null &&
        set === row.sets[row.sets.length - 1] &&
        set.targetWeightKg !== null,
      barbell: /^(barra|barbell)/i.test(row.exercise.exercise?.equipment ?? ''),
    };
  })();
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
      title={
        <>
          SEMANA {session.weekNumber}{' '}
          <Text style={styles.titleDay}>DÍA {session.dayNumber}</Text>
        </>
      }
      subtitle={`${
        // Sin nombre propio el servidor manda "Día N", que ya está en el título.
        session.dayLabel === `Día ${session.dayNumber}` ? '' : `${session.dayLabel} · `
      }${formatLoad(Math.round(summary.volumeKg), unit)} de volumen`}
      trailing={
        <View style={styles.trailing}>
          <Text
            style={styles.progress}
            accessibilityLabel={`${summary.done} de ${summary.total} sets`}
          >
            {summary.done}
            <Text style={styles.progressTotal}>/{summary.total}</Text>
          </Text>
          {dayRir != null ? (
            <Text style={styles.rir} accessibilityLabel={`Deja ${dayRir} repeticiones en reserva`}>
              {dayRir} RIR
            </Text>
          ) : null}
        </View>
      }
    >
      {session.isDeload ? (
        <View style={styles.deload}>
          <Ionicons name="arrow-down" size={14} color={color.textMuted} />
          <Text style={styles.deloadText}>
            <Text style={styles.deloadStrong}>Semana de deload. </Text>
            Menos sets y menos peso para que llegues fresco al próximo bloque.
          </Text>
        </View>
      ) : null}

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

      {rest !== null ? (
        <RestTimer seconds={rest.seconds} runKey={rest.key} onDismiss={() => setRest(null)}>
          {focus !== null && focus.set.targetWeightKg !== null ? (
            <>
              <Text style={styles.upNext}>
                Sigue el set {focus.set.index + 1} de {focus.exercise.name}:{' '}
                {formatNumber(focus.set.targetWeightKg, unit)} {unit} × {focus.set.targetReps}
              </Text>
              {focus.barbell && unit === 'kg' ? (
                <LoadedBar kg={focus.set.targetWeightKg} />
              ) : null}
            </>
          ) : null}
        </RestTimer>
      ) : focus !== null ? (
        <FocusSet
          exerciseName={focus.exercise.name}
          setNumber={focus.set.index + 1}
          setCount={focus.setCount}
          unit={unit}
          targetWeightKg={focus.set.targetWeightKg}
          targetReps={focus.set.targetReps}
          why={focus.set.why || focus.exercise.why}
          rir={focus.exercise.targetRir ?? null}
          barbell={focus.barbell}
          warmup={
            // Solo antes del primer set de un ejercicio con barra y peso pautado.
            focus.barbell && focus.set.index === 0 && focus.set.targetWeightKg !== null
              ? {
                  sets: warmupSets(focus.set.targetWeightKg),
                  done: warmDone[focus.exercise.id] ?? 0,
                  onChange: (done) => {
                    setWarmDone((w) => ({ ...w, [focus.exercise.id]: done }));
                    Vibration.vibrate(TAP_MS);
                  },
                }
              : undefined
          }
          onDone={() => {
            const { targetWeightKg, targetReps } = focus.set;
            if (targetWeightKg === null || targetReps === null) return;
            if (focus.technique) {
              setTechniqueFor(focus.exercise.id);
              return;
            }
            onToggle(focus.exercise.id, focus.exercise.restSeconds)(
              focus.set.index,
              targetWeightKg,
              targetReps,
            );
          }}
          onReport={() =>
            setDeviation({ exerciseId: focus.exercise.id, index: focus.set.index })
          }
        />
      ) : null}

      <ScrollView
        ref={listRef}
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
        {resolved.map(({ exercise, sets }) => {
          const group = groups.get(exercise.muscle) ?? [];
          const firstOfGroup = group[0]?.exercise.id === exercise.id;
          const lastOfGroup = group[group.length - 1]?.exercise.id === exercise.id;
          const groupDone = group.every((r) => r.sets.every((x) => x.done));
          const feedbackGiven = groupFeedback(exercise.muscle);
          return (
            <View
              key={exercise.id}
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                const prev = cardY.current[exercise.id];
                cardY.current[exercise.id] = y;
                // La tarjeta en curso se mueve al abrir la sesión a medias y cuando
                // la de arriba crece con su fila de feedback: en ambos casos se sigue.
                if (exercise.id === focusId && prev !== y) scrollToCard(y, prev !== undefined);
              }}
            >
              <SessionExerciseCard
                exercise={exercise}
                sets={sets}
                unit={unit}
                prelude={
                  firstOfGroup && !feedbackGiven ? (
                    <SorenessAsk
                      muscle={muscleLabel(exercise.muscle)}
                      value={soreness[exercise.muscle] ?? null}
                      onChange={(v) => setSoreness((x) => ({ ...x, [exercise.muscle]: v }))}
                    />
                  ) : undefined
                }
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
                techniqueOpen={techniqueFor === exercise.id}
                onTechnique={() =>
                  setTechniqueFor((open) => (open === exercise.id ? null : exercise.id))
                }
                onTechniqueSave={(parts) => {
                  const last = sets[sets.length - 1];
                  if (last === undefined) return;
                  const { reps, subSets } = joinParts(parts);
                  void reportSet(exercise.id, last.index, {
                    weightKg: last.targetWeightKg,
                    reps,
                    rpe: null,
                    subSets,
                  });
                  setTechniqueFor(null);
                  Vibration.vibrate(TAP_MS);
                  setRest({ seconds: exercise.restSeconds, key: `${exercise.id}:${last.index}` });
                }}
                onHistory={() =>
                  setHistoryFor({
                    sessionId: session.id,
                    sessionExerciseId: exercise.id,
                    name: exercise.name,
                  })
                }
              />

              {lastOfGroup && groupDone && !feedbackGiven ? (
                <MuscleFeedback
                  muscle={muscleLabel(exercise.muscle)}
                  exercises={group.map((r) => ({
                    id: r.exercise.id,
                    name: r.exercise.name,
                    exercise: r.exercise.exercise,
                  }))}
                  soreness={soreness[exercise.muscle] ?? null}
                  unit={unit}
                  aggressiveness="Media"
                  onSave={(byExercise) => {
                    for (const [id, fb] of Object.entries(byExercise)) void saveFeedback(id, fb);
                  }}
                />
              ) : null}
            </View>
          );
        })}

        {summary.total > 0 && summary.done === summary.total ? (
          <SessionDone
            items={[...groups.keys()].map((muscle) => ({
              id: muscle,
              name: muscleLabel(muscle),
              feedback: groupFeedback(muscle),
            }))}
          />
        ) : null}
      </ScrollView>

      <HistorySheet target={historyFor} unit={unit} onClose={() => setHistoryFor(null)} />

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

/**
 * Lo que se ve al terminar. Terminar el entreno es lo que hace que cuente.
 *
 * Lista los músculos con su feedback. El que falta se da en su tarjeta, arriba
 * en la lista, y sin él el motor no ajusta ese músculo la semana que viene.
 */
function SessionDone({ items }: { items: { id: string; name: string; feedback: boolean }[] }) {
  const complete = useWorkout((s) => s.complete);
  const load = useWorkout((s) => s.load);
  const [closing, setClosing] = useState(false);
  const missing = items.some((i) => !i.feedback);

  return (
    <View style={styles.doneBanner}>
      <Text style={styles.doneTitle}>Entreno completo</Text>
      {items.map((i) => (
        <View key={i.id} style={styles.doneRow}>
          <Text style={styles.doneName} numberOfLines={1}>
            {i.name}
          </Text>
          <Text style={[styles.doneState, !i.feedback && styles.doneMissing]}>
            {i.feedback ? 'feedback dado' : 'falta el feedback'}
          </Text>
        </View>
      ))}
      {missing ? (
        <Text style={styles.doneText}>
          Sin feedback, el motor no ajusta ese músculo la semana que viene. Lo das en
          su tarjeta, arriba.
        </Text>
      ) : null}
      <Pressable
        onPress={() => {
          setClosing(true);
          void complete().then(() => load());
        }}
        disabled={closing}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.finish,
          closing && { opacity: 0.5 },
          pressed && !closing && { opacity: 0.7 },
        ]}
      >
        <Text style={styles.finishText}>Terminar entreno</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: space.lg },
  titleDay: { color: color.textFaint },
  trailing: { alignItems: 'flex-end' },
  progress: { ...condensed, color: color.text, fontSize: 28, fontVariant: ['tabular-nums'] },
  rir: { color: color.accent, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  deload: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    backgroundColor: color.bgSunken,
  },
  deloadText: { flex: 1, color: color.textMuted, fontSize: 12.5, lineHeight: 17 },
  deloadStrong: { color: color.text, fontWeight: '600' },
  progressTotal: { color: color.textFaint, fontSize: 20 },
  upNext: { color: color.bone, fontSize: 14, lineHeight: 19 },
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
  bannerText: { color: color.textMuted, fontSize: 12, flex: 1, lineHeight: 16 },

  doneBanner: {
    margin: space.lg,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: color.slam,
    gap: space.xs,
  },
  doneTitle: { color: color.bone, fontSize: 16, fontWeight: '600', marginBottom: space.xs },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 44,
  },
  doneName: { flex: 1, color: color.bone, fontSize: 14 },
  doneState: { color: color.bone, opacity: 0.75, fontSize: 13 },
  doneMissing: { opacity: 1, fontWeight: '600' },
  doneText: { color: color.bone, opacity: 0.85, fontSize: 13, lineHeight: 18 },
  finish: {
    backgroundColor: color.bone,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: radius.chip,
    marginTop: space.sm,
  },
  finishText: { ...condensed, color: color.onBone, fontSize: 22, letterSpacing: 0.5 },

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
