/**
 * Generar la sesión del día. Solo el coach.
 *
 * Es el momento en que el motor decide: se elige el mesociclo y la semana, y
 * el servidor calcula carga y series de cada ejercicio con el RIR y el
 * feedback que el atleta reportó, y las **congela**. A partir de ahí, esa
 * sesión ya no cambia aunque cambien las reglas.
 *
 * El día se elige entre los del mesociclo (D1, D2...). El título que ve el
 * atleta sale solo: el nombre que el coach le puso al día, o "Día N".
 */

import { useCallback, useState } from 'react';
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

import { ApiError } from '@/api/client';
import { createSession, listMesocycles } from '@/api/endpoints';
import type { MesocycleSummaryOut } from '@/api/types';
import { Chip } from '@/components/Chip';
import { dayLabel } from '@/lib/days';
import { useRemote } from '@/lib/remote';
import { color, palette, radius, space } from '@/theme/tokens';

export function GenerateSessionSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const mesos = useRemote<MesocycleSummaryOut[]>(
    useCallback(() => listMesocycles(), []),
    [],
  );

  const [mesoId, setMesoId] = useState<string | null>(null);
  const [week, setWeek] = useState('1');
  const [day, setDay] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = (mesos.data ?? []).filter((m) => m.status === 'active');
  const chosen = list.find((m) => m.id === mesoId) ?? null;

  async function submit() {
    if (chosen === null || busy) return;

    const weekNumber = Number.parseInt(week, 10);
    if (!Number.isFinite(weekNumber) || weekNumber < 1) {
      setError('La semana tiene que ser un número.');
      return;
    }
    if (weekNumber > chosen.totalWeeks) {
      setError(`Este bloque tiene ${chosen.totalWeeks} semanas.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await createSession(chosen.id, weekNumber, day);
      onCreated();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.offline
            ? 'Sin conexión con el servidor.'
            : e.message
          : 'No se pudo generar.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>GENERAR SESIÓN</Text>
            <Text style={styles.subtitle}>El motor calcula y congela el plan</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
            <Ionicons name="close" size={19} color={color.textMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>MESOCICLO</Text>
          {mesos.loading && mesos.data === null ? (
            <ActivityIndicator color={color.accent} />
          ) : list.length === 0 ? (
            <Text style={styles.help}>
              No tenés bloques activos. Creá uno en la pestaña Mesos.
            </Text>
          ) : (
            <View style={styles.chips}>
              {list.map((m) => (
                <Chip
                  key={m.id}
                  label={`${m.athleteName} · ${m.name}`}
                  active={mesoId === m.id}
                  onPress={() => {
                    setMesoId(m.id);
                    setDay(1);
                    // La semana en curso del bloque es la respuesta correcta
                    // casi siempre; se deja editable por si no lo es.
                    setWeek(String(m.currentWeekIndex + 1));
                  }}
                />
              ))}
            </View>
          )}

          <Text style={styles.label}>SEMANA</Text>
          <TextInput
            style={styles.input}
            value={week}
            onChangeText={setWeek}
            keyboardType="numeric"
            accessibilityLabel="Semana"
          />
          {chosen !== null ? (
            <Text style={styles.help}>
              Este bloque tiene {chosen.totalWeeks} semanas; la última es el deload.
            </Text>
          ) : null}

          <Text style={styles.label}>DÍA</Text>
          {chosen !== null ? (
            <View style={styles.chips}>
              {Array.from({ length: chosen.daysPerWeek }, (_, i) => i + 1).map((n) => (
                <Chip
                  key={n}
                  label={dayLabel(n, chosen.days)}
                  active={day === n}
                  onPress={() => setDay(n)}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.help}>Elige primero el mesociclo.</Text>
          )}
          <Text style={styles.help}>
            Si ese día ya tiene una sesión abierta esa semana, se abre la misma.
          </Text>

          {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={() => void submit()}
            disabled={chosen === null || busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primary,
              (chosen === null || busy) && styles.off,
              pressed && chosen !== null && !busy && { backgroundColor: palette.accentEdge },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={color.onAccent} />
            ) : (
              <Text style={styles.primaryText}>GENERAR</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: {
    maxHeight: '82%',
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
  title: { color: color.text, fontSize: 16, fontWeight: '600', letterSpacing: 2.6 },
  subtitle: { color: color.textMuted, fontSize: 12.5, marginTop: 2 },
  body: { padding: space.lg, paddingTop: space.sm, gap: space.sm },
  label: { color: color.textMuted, fontSize: 10, letterSpacing: 2, marginTop: space.sm },
  help: { color: color.textFaint, fontSize: 11.5, lineHeight: 16 },
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
  footer: {
    padding: space.lg,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  primary: {
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.chip,
  },
  off: { opacity: 0.4 },
  primaryText: { color: color.onAccent, fontSize: 13, fontWeight: '600', letterSpacing: 2.4 },
});
