/**
 * Nuevo mesociclo: duración, objetivo y volumen inicial por músculo.
 *
 * La frase de "progresión automática" se compone con los valores elegidos, como
 * en el prototipo. En la Fase 2 el botón llama a `POST /mesocycles`, que genera
 * las N semanas de una vez; aquí solo cierra.
 */

import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip } from '@/components/Chip';
import { color, palette, radius, space } from '@/theme/tokens';

const LENGTHS = ['4 sem', '5 sem', '6 sem', '8 sem'];
const GOALS = ['Hipertrofia', 'Fuerza', 'Híbrido'];

const INITIAL_VOLUME: Record<string, number> = {
  Pecho: 14,
  Espalda: 18,
  Hombros: 16,
  Piernas: 20,
};

const MIN_SETS = 6;
const MAX_SETS = 26;
const STEP = 2;

export function NewMesoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [length, setLength] = useState('6 sem');
  const [goal, setGoal] = useState('Hipertrofia');
  const [volume, setVolume] = useState(INITIAL_VOLUME);

  const total = useMemo(
    () => Object.values(volume).reduce((a, b) => a + b, 0),
    [volume],
  );

  const weeks = parseInt(length, 10);
  const preview =
    `Sumará 1–2 hard sets por músculo cada semana hasta la semana ${weeks - 1}, ` +
    `ajustando la carga con tu RIR reportado, y cerrará con un deload al 60% del volumen.`;

  function bump(muscle: string, delta: number) {
    setVolume((v) => ({
      ...v,
      [muscle]: Math.max(MIN_SETS, Math.min(MAX_SETS, (v[muscle] ?? MIN_SETS) + delta)),
    }));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.title}>NUEVO MESOCICLO</Text>
            <Text style={styles.subtitle}>Volumen inicial y progresión</Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
            hitSlop={10}
          >
            <Ionicons name="close" size={19} color={color.textMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.group}>
            <Text style={styles.groupLabel}>Duración</Text>
            <View style={styles.options}>
              {LENGTHS.map((l) => (
                <Chip key={l} label={l} active={length === l} onPress={() => setLength(l)} />
              ))}
            </View>
          </View>

          <View style={styles.group}>
            <Text style={styles.groupLabel}>Objetivo</Text>
            <View style={styles.options}>
              {GOALS.map((g) => (
                <Chip key={g} label={g} active={goal === g} onPress={() => setGoal(g)} />
              ))}
            </View>
          </View>

          <View style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupLabel}>Hard sets iniciales</Text>
              <Text style={styles.groupNote}>{total} hard sets/semana</Text>
            </View>

            {Object.keys(volume).map((m) => (
              <View key={m} style={styles.volumeRow}>
                <Text style={styles.muscle}>{m}</Text>
                <View style={styles.track}>
                  <View
                    style={[styles.fill, { width: `${((volume[m] ?? 0) / MAX_SETS) * 100}%` }]}
                  />
                </View>
                <Pressable
                  onPress={() => bump(m, -STEP)}
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar sets de ${m}`}
                  style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                >
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.count}>{volume[m]}</Text>
                <Pressable
                  onPress={() => bump(m, STEP)}
                  accessibilityRole="button"
                  accessibilityLabel={`Añadir sets a ${m}`}
                  style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View style={styles.preview}>
            <View style={styles.previewHead}>
              <Ionicons name="sparkles" size={12} color={palette.a300} />
              <Text style={styles.previewLabel}>PROGRESIÓN AUTOMÁTICA</Text>
            </View>
            <Text style={styles.previewText}>{preview}</Text>
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Atrás</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Generar mesociclo</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,10,10,0.82)' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: color.bgRaised,
    borderTopLeftRadius: 2,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    borderColor: color.border,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: 14,
    paddingBottom: 6,
  },
  headText: { flex: 1, gap: 2 },
  title: { color: color.text, fontSize: 23, fontWeight: '700', letterSpacing: 0.5 },
  subtitle: { color: color.textMuted, fontSize: 11.5 },

  body: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: 15 },
  group: { gap: 7 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  groupLabel: { color: palette.n400, fontSize: 12 },
  groupNote: { color: palette.a300, fontSize: 11 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.n900,
  },
  muscle: { width: 74, color: color.text, fontSize: 12.5 },
  track: { flex: 1, height: 5, borderRadius: 3, backgroundColor: palette.n800, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: palette.a500 },
  step: {
    width: 30,
    height: 30,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: palette.n800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: palette.n400, fontSize: 15 },
  count: {
    width: 26,
    textAlign: 'center',
    color: color.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  preview: {
    padding: 12,
    borderRadius: radius.chip,
    backgroundColor: palette.a900,
    borderWidth: 1,
    borderColor: palette.a800,
    gap: 6,
  },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  previewLabel: { color: palette.a300, fontSize: 10, letterSpacing: 2 },
  previewText: { color: palette.a100, fontSize: 12.5, lineHeight: 18 },

  actions: {
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: space.lg,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  secondary: {
    height: 42,
    paddingHorizontal: space.lg,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: color.textMuted, fontSize: 13, fontWeight: '500' },
  primary: {
    flex: 1,
    height: 42,
    borderRadius: radius.chip,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: color.onAccent, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
