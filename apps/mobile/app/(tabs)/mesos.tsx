/**
 * Mesociclos.
 *
 * Dos vistas en una ruta, como en el prototipo:
 *
 * - **Coach**: la lista de bloques de su cartera, y el botón de crear uno nuevo.
 * - **Atleta**: su bloque en curso, con la progresión semana a semana.
 *
 * La proyección se calcula **en el teléfono** con el mismo motor que usa el
 * servidor. No es una duplicación por descuido: el atleta abre esta pantalla en
 * el gimnasio, a veces sin cobertura, y una tabla que necesita red para
 * dibujarse no sirve. El servidor manda sobre lo que se persiste; esto es solo
 * mirar hacia adelante.
 */

import { useCallback, useMemo, useState } from 'react';
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
import {
  Exercise,
  MuscleGroup,
  planExercise,
  projectMesocycle,
} from '@cage/engine';

import { getMesocycle, listAthletes, listMesocycles } from '@/api/endpoints';
import type {
  MesocycleOut,
  MesocycleSummaryOut,
  UserOut,
} from '@/api/types';
import { Screen } from '@/components/Screen';
import { NewMesoSheet } from '@/features/mesos/NewMesoSheet';
import { PlanGrid } from '@/features/mesos/PlanGrid';
import { VolumeChart } from '@/features/mesos/VolumeChart';
import { formatNumber } from '@/lib/units';
import { useRemote } from '@/lib/remote';
import { useApp } from '@/stores/app';
import { useSession } from '@/stores/session';
import { color, radius, space } from '@/theme/tokens';

export default function MesosScreen() {
  // Crear mesociclos es potestad del coach. El atleta solo consulta: es una
  // regla de producto, y el servidor la impone aparte de esto.
  const isCoach = useApp((s) => s.role) === 'coach';
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId !== null) {
    return <MesoDetail id={openId} onBack={() => setOpenId(null)} />;
  }
  return isCoach ? <CoachList onOpen={setOpenId} /> : <AthleteMeso />;
}

/* ── Coach: la lista ──────────────────────────────────────────────────────── */

function CoachList({ onOpen }: { onOpen: (id: string) => void }) {
  const mesos = useRemote<MesocycleSummaryOut[]>(
    useCallback(() => listMesocycles(), []),
    [],
  );
  const athletes = useRemote<UserOut[]>(useCallback(() => listAthletes(), []), []);
  const [creating, setCreating] = useState(false);

  const list = mesos.data ?? [];

  return (
    <Screen
      title="MESOCICLOS"
      subtitle={list.length === 0 ? undefined : `${list.length} bloques`}
      trailing={
        <Pressable
          onPress={() => setCreating(true)}
          accessibilityRole="button"
          accessibilityLabel="Nuevo mesociclo"
          style={({ pressed }) => [styles.add, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="add" size={18} color={color.accent} />
        </Pressable>
      }
    >
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={mesos.loading}
            onRefresh={mesos.reload}
            tintColor={color.accent}
          />
        }
      >
        {mesos.loading && mesos.data === null ? <Loading /> : null}

        {mesos.data === null && !mesos.loading ? (
          <Failure
            message={mesos.error}
            offline={mesos.offline}
            onRetry={mesos.reload}
          />
        ) : null}

        {mesos.data !== null && list.length === 0 ? (
          <Empty
            title="Ningún mesociclo todavía"
            body="Creá el primero con el + de arriba. Vas a necesitar al menos un atleta en tu cartera."
          />
        ) : null}

        {list.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => onOpen(m.id)}
            accessibilityRole="button"
            accessibilityLabel={`Abrir ${m.name} de ${m.athleteName}`}
            style={({ pressed }) => [styles.mesoRow, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.rowText}>
              <Text style={styles.name}>{m.name}</Text>
              <Text style={styles.muscle}>
                {m.athleteName} · sem {m.currentWeekIndex + 1} de {m.totalWeeks} ·{' '}
                {m.exerciseCount} ejercicios
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={color.textFaint} />
          </Pressable>
        ))}
      </ScrollView>

      <NewMesoSheet
        visible={creating}
        athletes={athletes.data ?? []}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          mesos.reload();
        }}
      />
    </Screen>
  );
}

/* ── Atleta: su bloque en curso ───────────────────────────────────────────── */

function AthleteMeso() {
  const mesos = useRemote<MesocycleSummaryOut[]>(
    useCallback(() => listMesocycles(), []),
    [],
  );
  const active = mesos.data?.find((m) => m.status === 'active') ?? mesos.data?.[0];

  if (mesos.loading && mesos.data === null) {
    return (
      <Screen title="MESOCICLO">
        <Loading />
      </Screen>
    );
  }
  if (active === undefined) {
    return (
      <Screen title="MESOCICLO">
        {mesos.data === null ? (
          <Failure message={mesos.error} offline={mesos.offline} onRetry={mesos.reload} />
        ) : (
          <Empty
            title="Sin mesociclo asignado"
            body="Tu coach todavía no te programó un bloque."
          />
        )}
      </Screen>
    );
  }
  return <MesoDetail id={active.id} onBack={null} />;
}

/* ── Detalle: la progresión ───────────────────────────────────────────────── */

function MesoDetail({ id, onBack }: { id: string; onBack: (() => void) | null }) {
  const remote = useRemote<MesocycleOut>(
    useCallback(() => getMesocycle(id), [id]),
    [id],
  );
  const unit = useSession((s) => s.unit);

  /**
   * El coach alterna entre previsión y plan; el atleta solo ve la previsión.
   *
   * Son dos cosas distintas y por eso no se mezclan en una pantalla: la
   * previsión responde "¿hacia dónde va esto?", el plan responde "¿qué hago yo
   * con ello?". Y pautar no es asunto del atleta.
   */
  const [tab, setTab] = useState<'proyeccion' | 'plan'>('proyeccion');
  const isCoach = onBack !== null;

  const meso = remote.data;

  /**
   * Proyección con el motor, a partir de las cargas de arranque.
   *
   * Se asume feedback neutro porque es una previsión, no un historial: enseña
   * lo que pasaría si el atleta entrena dentro de lo esperado. Lo que de verdad
   * ocurra lo recalcula el servidor semana a semana con el feedback real.
   */
  const projections = useMemo(() => {
    if (meso === null) return [];
    return meso.exercises.map((mex) => {
      const exercise: Exercise = {
        id: mex.id,
        name: mex.name,
        muscle: mex.muscle as MuscleGroup,
        equipment: mex.equipment,
        repLo: mex.prescription?.repLo ?? mex.repLo,
        repHi: mex.prescription?.repHi ?? mex.repHi,
        targetRir: mex.prescription?.targetRir ?? mex.targetRir,
        loadIncrementKg: mex.loadIncrementKg,
        last: {
          weightKg: mex.startingLoadKg,
          reps: mex.startingReps,
          rir: mex.prescription?.targetRir ?? mex.targetRir,
          sets: mex.startingSets,
          feedback: {
            joint: 'Ninguno',
            soreness: 'Se fue justo a tiempo',
            pump: 'Moderado',
            volume: 'Justo',
          },
        },
      };

      return {
        exercise,
        weeks: projectMesocycle(exercise, planExercise(exercise, meso.aggressiveness), {
          totalWeeks: meso.totalWeeks,
          currentWeekIndex: meso.currentWeekIndex,
        }),
      };
    });
  }, [meso]);

  const weeklyVolume = useMemo(() => {
    if (meso === null) return [];
    const totals = Array.from({ length: meso.totalWeeks }, () => 0);
    for (const { weeks } of projections) {
      weeks.forEach((w, i) => {
        totals[i] = (totals[i] ?? 0) + w.sets;
      });
    }
    return totals;
  }, [projections, meso]);

  const back =
    onBack === null ? undefined : (
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Volver"
        hitSlop={10}
        style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="arrow-back" size={19} color={color.textMuted} />
      </Pressable>
    );

  if (meso === null) {
    return (
      <Screen title="MESOCICLO" leading={back}>
        {remote.loading ? (
          <Loading />
        ) : (
          <Failure
            message={remote.error}
            offline={remote.offline}
            onRetry={remote.reload}
          />
        )}
      </Screen>
    );
  }

  const current = meso.currentWeekIndex;

  return (
    <Screen
      title={meso.name.toUpperCase()}
      subtitle={`${meso.totalWeeks - 1} semanas + deload · semana ${current + 1} en curso`}
      leading={back}
    >
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={remote.loading}
            onRefresh={remote.reload}
            tintColor={color.accent}
          />
        }
      >
        {isCoach ? (
          <View style={styles.tabs}>
            {(['proyeccion', 'plan'] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                accessibilityRole="button"
                accessibilityLabel={t === 'plan' ? 'Pautar el plan' : 'Ver la previsión'}
                style={[styles.tab, tab === t && styles.tabOn]}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                  {t === 'plan' ? 'PAUTAR' : 'PREVISIÓN'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {isCoach && tab === 'plan' ? <PlanGrid mesocycleId={id} /> : null}

        {isCoach && tab === 'plan' ? null : (
          <>
        <VolumeChart weeks={weeklyVolume} currentIndex={current} />

        <Text style={styles.sectionLabel}>PROGRESIÓN POR EJERCICIO</Text>

        {projections.map(({ exercise, weeks }) => (
          <View key={exercise.id} style={styles.card}>
            <Text style={styles.name}>{exercise.name}</Text>
            <Text style={styles.muscle}>{exercise.muscle}</Text>

            <View style={styles.tableHead}>
              <Text style={[styles.cell, styles.cellWeek, styles.headText]}>Sem</Text>
              <Text style={[styles.cell, styles.headText]}>Sets</Text>
              <Text style={[styles.cell, styles.cellWide, styles.headText]}>Reps</Text>
              <Text style={[styles.cell, styles.cellWide, styles.headText]}>Carga</Text>
              <Text style={[styles.cell, styles.headText]}>RIR</Text>
            </View>

            {weeks.map((w) => {
              const isNow = w.index === current;
              return (
                <View
                  key={w.index}
                  style={[styles.row, isNow && styles.rowNow, w.isDeload && styles.rowDeload]}
                >
                  <Text style={[styles.cell, styles.cellWeek, isNow && styles.textNow]}>
                    {w.isDeload ? 'DL' : `s${w.weekNumber}`}
                  </Text>
                  <Text style={[styles.cell, isNow && styles.textNow]}>{w.sets}</Text>
                  <Text style={[styles.cell, styles.cellWide, isNow && styles.textNow]}>
                    {w.repLo === w.repHi ? w.repLo : `${w.repLo}–${w.repHi}`}
                  </Text>
                  <Text style={[styles.cell, styles.cellWide, isNow && styles.textNow]}>
                    {formatNumber(w.loadKg, unit)}
                  </Text>
                  <Text style={[styles.cell, isNow && styles.textNow]}>{w.targetRir}</Text>
                </View>
              );
            })}
          </View>
        ))}

        <Text style={styles.footnote}>
          {onBack === null
            ? 'Tu coach programa este mesociclo. El motor ajusta la carga con el RIR y el feedback que reportes cada día.'
            : 'Previsión del motor con feedback neutro. Para fijar números a mano, usá PAUTAR.'}
        </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/* ── Estados ──────────────────────────────────────────────────────────────── */

function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={color.accent} />
    </View>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function Failure({
  message,
  offline,
  onRetry,
}: {
  message: string | null;
  offline: boolean;
  onRetry: () => void;
}) {
  return (
    <View style={styles.center}>
      <Ionicons
        name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
        size={28}
        color={color.textFaint}
      />
      <Text style={styles.emptyTitle}>{offline ? 'Sin conexión' : 'No se pudo cargar'}</Text>
      <Text style={styles.emptyBody}>{message ?? 'Inténtalo de nuevo.'}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.emptyBody}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, paddingTop: 0, gap: space.sm, paddingBottom: space.xxl },
  add: { padding: 4 },
  back: { padding: 4 },

  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xxl,
  },
  emptyTitle: { color: color.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyBody: { color: color.textMuted, fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  retry: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: space.sm,
  },

  mesoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: 13,
    borderRadius: radius.card,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  rowText: { flex: 1, gap: 2 },

  tabs: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 2,
    borderBottomColor: color.border,
  },
  tabOn: { borderBottomColor: color.accent },
  tabText: { color: color.textMuted, fontSize: 10.5, letterSpacing: 2 },
  tabTextOn: { color: color.text, fontWeight: '600' },

  sectionLabel: {
    color: color.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    marginTop: space.sm,
  },
  card: {
    padding: 13,
    borderRadius: radius.card,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  name: { color: color.text, fontSize: 14.5, fontWeight: '600' },
  muscle: { color: color.textMuted, fontSize: 11.5, marginTop: 1 },

  tableHead: {
    flexDirection: 'row',
    marginTop: space.md,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  headText: { color: color.textFaint, fontSize: 9.5, letterSpacing: 1.3 },
  row: { flexDirection: 'row', paddingVertical: 7 },
  rowNow: { backgroundColor: color.rowHighlight },
  rowDeload: { opacity: 0.55 },
  cell: {
    flex: 1,
    color: color.textMuted,
    fontSize: 12.5,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  cellWeek: { flex: 0.8 },
  cellWide: { flex: 1.4 },
  textNow: { color: color.text, fontWeight: '600' },

  footnote: {
    color: color.textFaint,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: space.sm,
  },
});
