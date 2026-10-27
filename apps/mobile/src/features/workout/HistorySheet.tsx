/**
 * Las veces anteriores que el atleta hizo un ejercicio.
 *
 * Responde la pregunta de antes de cada serie: "¿cuánto moví la última vez?".
 * Cruza bloques, porque la sentadilla del bloque pasado es la misma
 * sentadilla, y enseña el feedback que dio en cada una: es lo que explica por
 * qué el motor subió o no.
 *
 * Es lo único de la sesión que necesita red. Sin ella lo dice y ya; el
 * entreno no depende de esto.
 */

import { useCallback } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { exerciseHistory } from '@/api/endpoints';
import type { HistoryEntryOut } from '@/api/types';
import { useRemote } from '@/lib/remote';
import { type Unit, formatNumber } from '@/lib/units';
import { color, condensed, radius, space } from '@/theme/tokens';

export interface HistoryTarget {
  sessionId: string;
  sessionExerciseId: string;
  name: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function setText(s: HistoryEntryOut['sets'][number], unit: Unit): string {
  const parts = s.subSets ? `+${s.subSets}` : '';
  return `${s.weightKg === null ? '—' : formatNumber(s.weightKg, unit)} × ${s.reps ?? '—'}${parts}`;
}

/** El set con el 1RM estimado más alto (Epley). Sin reps legibles no compite. */
function bestSet(entries: HistoryEntryOut[]) {
  let best: { set: HistoryEntryOut['sets'][number]; score: number } | null = null;
  for (const e of entries) {
    for (const s of e.sets) {
      const reps = Number.parseInt(s.reps ?? '', 10);
      if (s.weightKg === null || !Number.isFinite(reps)) continue;
      const score = s.weightKg * (1 + reps / 30);
      if (best === null || score > best.score) best = { set: s, score };
    }
  }
  return best?.set ?? null;
}

export function HistorySheet({
  target,
  unit,
  onClose,
}: {
  target: HistoryTarget | null;
  unit: Unit;
  onClose: () => void;
}) {
  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        {target !== null ? <Body target={target} unit={unit} /> : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.closeText}>Cerrar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Body({ target, unit }: { target: HistoryTarget; unit: Unit }) {
  const remote = useRemote<HistoryEntryOut[]>(
    useCallback(
      () => exerciseHistory(target.sessionId, target.sessionExerciseId),
      [target.sessionId, target.sessionExerciseId],
    ),
    [target.sessionId, target.sessionExerciseId],
  );
  const entries = remote.data ?? [];
  const best = bestSet(entries);

  return (
    <View style={styles.body}>
      <Text style={styles.title}>{target.name}</Text>
      <Text style={styles.subtitle}>Lo que hiciste las veces anteriores</Text>

      {remote.data === null ? (
        <View style={styles.center}>
          {remote.loading ? (
            <ActivityIndicator color={color.accent} />
          ) : (
            <Text style={styles.subtitle}>
              {remote.offline
                ? 'Sin conexión. El historial necesita red; tu entreno no.'
                : (remote.error ?? 'No se pudo cargar el historial.')}
            </Text>
          )}
        </View>
      ) : entries.length === 0 ? (
        <Text style={[styles.subtitle, styles.empty]}>
          Es la primera vez que haces este ejercicio. Desde hoy aparece aquí.
        </Text>
      ) : (
        <ScrollView style={styles.list}>
          {best !== null ? (
            <View style={styles.best}>
              <Text style={styles.bestLabel}>Mejor marca</Text>
              <Text style={styles.bestValue}>{setText(best, unit)}</Text>
            </View>
          ) : null}

          {entries.map((e) => (
            <View key={e.sessionId} style={styles.entry}>
              <View style={styles.when}>
                <Text style={styles.week}>
                  {e.isDeload ? 'Deload' : `Semana ${e.weekNumber}`}
                </Text>
                <Text style={styles.meta}>
                  {shortDate(e.completedAt)} · {e.targetRir} RIR
                  {e.otherBlock ? ' · bloque anterior' : ''}
                </Text>
              </View>
              <View style={styles.sets}>
                {e.sets.length === 0 ? (
                  <Text style={styles.meta}>Sin sets marcados</Text>
                ) : (
                  e.sets.map((s, i) => (
                    <Text key={i} style={styles.set}>
                      {setText(s, unit)}
                    </Text>
                  ))
                )}
                {e.feedback !== null ? (
                  <Text style={styles.feedback}>
                    pump {e.feedback.pump.toLowerCase()} · dolor {e.feedback.joint.toLowerCase()}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: color.bgRaised,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    borderColor: color.border,
    paddingBottom: space.xl,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border,
    alignSelf: 'center',
    marginTop: space.md,
  },
  body: { paddingHorizontal: space.lg, paddingTop: space.lg, flexShrink: 1 },
  title: { color: color.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { color: color.textMuted, fontSize: 13, lineHeight: 18 },
  empty: { marginTop: space.lg },
  center: { paddingVertical: space.xl, alignItems: 'center' },
  list: { marginTop: space.md },
  best: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    backgroundColor: color.bgSunken,
    marginBottom: space.sm,
  },
  bestLabel: { color: color.textMuted, fontSize: 13 },
  bestValue: { ...condensed, color: color.text, fontSize: 26, fontVariant: ['tabular-nums'] },
  entry: {
    flexDirection: 'row',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  when: { width: 112, gap: 2 },
  week: { color: color.text, fontSize: 14, fontWeight: '600' },
  meta: { color: color.textMuted, fontSize: 12 },
  sets: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 2 },
  set: { color: color.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  feedback: { width: '100%', color: color.textMuted, fontSize: 12, marginTop: 2 },
  close: {
    marginTop: space.md,
    marginHorizontal: space.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
  },
  closeText: { color: color.text, fontSize: 14 },
});
