/**
 * El coach pauta un ejercicio.
 *
 * Cada campo muestra al lado lo que sugiere el motor. Dejarlo en "Auto" devuelve
 * la decisión al algoritmo; escribir un valor lo fija. Así el coach ve siempre
 * qué opina el sistema antes de decidir, y puede soltar el control campo a campo
 * en vez de todo o nada.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Exercise } from '@cage/engine';
import { color, palette, radius, space } from '@/theme/tokens';
import { Unit, formatNumber, parseWeightInput, toKg } from '@/lib/units';
import { Prescription, formatRest } from '@/lib/prescription';

const REST_OPTIONS = [60, 90, 120, 150, 180, 240];

interface Props {
  exercise: Exercise | null;
  prescription: Prescription | undefined;
  /** Lo que el motor propone hoy, para mostrarlo al lado de cada campo. */
  suggestion: { sets: number; loadKg: number } | null;
  unit: Unit;
  onSave: (patch: Partial<Prescription>) => void;
  onClose: () => void;
}

export function EditPlanSheet({
  exercise,
  prescription,
  suggestion,
  unit,
  onSave,
  onClose,
}: Props) {
  const [sets, setSets] = useState('');
  const [load, setLoad] = useState('');
  const [repLo, setRepLo] = useState('');
  const [repHi, setRepHi] = useState('');
  const [rir, setRir] = useState('');
  const [rest, setRest] = useState(150);

  useEffect(() => {
    if (!exercise) return;
    setSets(prescription?.sets == null ? '' : String(prescription.sets));
    setLoad(prescription?.loadKg == null ? '' : formatNumber(prescription.loadKg, unit));
    setRepLo(prescription?.repLo == null ? '' : String(prescription.repLo));
    setRepHi(prescription?.repHi == null ? '' : String(prescription.repHi));
    setRir(prescription?.targetRir == null ? '' : String(prescription.targetRir));
    setRest(prescription?.restSeconds ?? 150);
  }, [exercise, prescription, unit]);

  function save() {
    onSave({
      sets: intOrNull(sets, 1, 12),
      loadKg: load.trim() === '' ? null : parseWeightInput(load, unit),
      repLo: intOrNull(repLo, 1, 60),
      repHi: intOrNull(repHi, 1, 60),
      targetRir: intOrNull(rir, 0, 6),
      restSeconds: rest,
    });
  }

  return (
    <Modal visible={exercise != null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.title}>PAUTAR EJERCICIO</Text>
            <Text style={styles.subject}>{exercise?.name}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
            <Ionicons name="close" size={19} color={color.textMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>
            Deja un campo vacío para que lo decida el motor. Lo que escribas manda sobre él.
          </Text>

          <Field
            label="Hard sets"
            value={sets}
            onChange={setSets}
            auto={suggestion ? `motor: ${suggestion.sets}` : undefined}
          />

          <Field
            label={`Carga de partida (${unit})`}
            value={load}
            onChange={setLoad}
            decimal
            auto={suggestion ? `motor: ${formatNumber(suggestion.loadKg, unit)}` : undefined}
          />

          <View style={styles.pair}>
            <Field label="Reps mín." value={repLo} onChange={setRepLo} auto={`ej.: ${exercise?.repLo}`} />
            <Field label="Reps máx." value={repHi} onChange={setRepHi} auto={`ej.: ${exercise?.repHi}`} />
          </View>

          <Field label="RIR objetivo" value={rir} onChange={setRir} auto={`ej.: ${exercise?.targetRir}`} />

          <View style={styles.group}>
            <Text style={styles.label}>Descanso entre series</Text>
            <View style={styles.rests}>
              {REST_OPTIONS.map((r) => {
                const active = rest === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => setRest(r)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.rest,
                      active && styles.restActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.restText, active && styles.restTextActive]}>
                      {formatRest(r)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Cancelar</Text>
          </Pressable>
          <Pressable
            onPress={save}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Guardar pauta</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  auto,
  decimal,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  auto?: string;
  decimal?: boolean;
}) {
  return (
    <View style={styles.group}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {auto ? <Text style={styles.auto}>{auto}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Auto"
        placeholderTextColor={color.textFaint}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        inputMode={decimal ? 'decimal' : 'numeric'}
        accessibilityLabel={label}
        style={styles.input}
      />
    </View>
  );
}

function intOrNull(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
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
  title: { color: color.text, fontSize: 21, fontWeight: '700', letterSpacing: 0.5 },
  subject: { color: color.textMuted, fontSize: 12.5 },
  body: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md },
  hint: { color: color.textFaint, fontSize: 12, lineHeight: 17 },
  group: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { color: palette.n400, fontSize: 12 },
  auto: { color: palette.a300, fontSize: 11 },
  pair: { flexDirection: 'row', gap: space.md },
  input: {
    color: color.text,
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    minWidth: 90,
  },
  rests: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rest: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
  },
  restActive: { borderColor: color.accent, backgroundColor: palette.a800 },
  restText: { color: palette.n400, fontSize: 13, fontVariant: ['tabular-nums'] },
  restTextActive: { color: palette.a100 },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  secondary: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
  },
  secondaryText: { color: color.textMuted, fontSize: 14, fontWeight: '500' },
  primary: {
    flex: 1,
    paddingVertical: space.md,
    borderRadius: radius.chip,
    backgroundColor: color.accent,
    alignItems: 'center',
  },
  primaryText: { color: color.onAccent, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
