/**
 * Mesociclo: cómo progresa cada ejercicio a lo largo de las semanas.
 *
 * La semana en curso es el plan real que devuelve el motor; el resto lo
 * extrapola `projectMesocycle`. La última fila es el deload.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { planExercise, projectMesocycle } from '@cage/engine';
import { Screen } from '@/components/Screen';
import { VolumeChart } from '@/features/mesos/VolumeChart';
import { NewMesoSheet } from '@/features/mesos/NewMesoSheet';
import { useApp } from '@/stores/app';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { color, radius, space } from '@/theme/tokens';
import { formatNumber } from '@/lib/units';

const CURRENT_WEEK_INDEX = 4;
const TOTAL_WEEKS = 7;

export default function MesosScreen() {
  // Crear y editar mesociclos es potestad del coach. El atleta solo consulta.
  const canProgram = useApp((s) => s.role) === 'coach';
  const exercises = useSession((s) => s.exercises);
  const aggressiveness = useSession((s) => s.aggressiveness);
  const unit = useSession((s) => s.unit);
  const newMesoOpen = useUi((s) => s.newMesoOpen);
  const openNewMeso = useUi((s) => s.openNewMeso);
  const closeNewMeso = useUi((s) => s.closeNewMeso);

  /** Hard sets totales por semana, sumando los ejercicios del meso. */
  const weeklyVolume = useMemo(() => {
    const totals = Array.from({ length: TOTAL_WEEKS }, () => 0);
    for (const ex of exercises) {
      const weeks = projectMesocycle(ex, planExercise(ex, aggressiveness), {
        totalWeeks: TOTAL_WEEKS,
        currentWeekIndex: CURRENT_WEEK_INDEX,
      });
      weeks.forEach((w, i) => {
        totals[i] = (totals[i] ?? 0) + w.sets;
      });
    }
    return totals;
  }, [exercises, aggressiveness]);

  const projections = useMemo(
    () =>
      exercises.map((ex) => ({
        exercise: ex,
        weeks: projectMesocycle(ex, planExercise(ex, aggressiveness), {
          totalWeeks: TOTAL_WEEKS,
          currentWeekIndex: CURRENT_WEEK_INDEX,
        }),
      })),
    [exercises, aggressiveness],
  );

  return (
    <Screen
      title="MESOCICLO"
      subtitle={`${TOTAL_WEEKS - 1} semanas + deload · semana ${CURRENT_WEEK_INDEX + 1} en curso`}
      trailing={
        canProgram ? (
          <Pressable
            onPress={openNewMeso}
            accessibilityRole="button"
            accessibilityLabel="Nuevo mesociclo"
            style={({ pressed }) => [styles.add, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="add" size={18} color={color.accent} />
          </Pressable>
        ) : null
      }
    >
      <ScrollView contentContainerStyle={styles.list}>
        <VolumeChart weeks={weeklyVolume} currentIndex={CURRENT_WEEK_INDEX} />

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
              const isNow = w.index === CURRENT_WEEK_INDEX;
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
          {canProgram
            ? 'Las semanas pasadas y futuras son una extrapolación del motor. Lo que pautes en cada ejercicio manda sobre ella.'
            : 'Tu coach programa este mesociclo. El motor ajusta la carga con el RIR y el feedback que reportes cada día.'}
        </Text>
      </ScrollView>

      <NewMesoSheet visible={canProgram && newMesoOpen} onClose={closeNewMeso} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, paddingTop: 0, gap: space.lg, paddingBottom: space.xxl },
  card: {
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
    padding: space.md,
    gap: 2,
  },
  name: { color: color.text, fontSize: 15, fontWeight: '600' },
  muscle: { color: color.textFaint, fontSize: 10, letterSpacing: 2, fontWeight: '600' },
  tableHead: {
    flexDirection: 'row',
    marginTop: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
    borderRadius: radius.chip,
  },
  rowNow: { backgroundColor: color.rowHighlight },
  rowDeload: { opacity: 0.55 },
  cell: {
    flex: 1,
    color: color.textMuted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  cellWeek: { flex: 0.8, textAlign: 'left', paddingLeft: space.sm },
  cellWide: { flex: 1.4 },
  headText: { color: color.textFaint, fontSize: 10, letterSpacing: 1.4, fontWeight: '600' },
  textNow: { color: color.text, fontWeight: '600' },
  footnote: { color: color.textFaint, fontSize: 12, lineHeight: 18 },
  sectionLabel: { color: color.textMuted, fontSize: 10, letterSpacing: 2, marginTop: space.sm },
  add: {
    width: 34,
    height: 34,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
