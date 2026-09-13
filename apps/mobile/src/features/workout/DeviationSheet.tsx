/**
 * Reporte de desviación: "esto es lo que pautó tu coach, esto es lo que hice".
 *
 * Es la única entrada numérica que tiene el atleta, y solo se abre cuando algo
 * no salió como estaba escrito. Por eso el formulario parte relleno con el
 * objetivo: si el atleta solo bajó una repetición, toca un botón y guarda.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { color, palette, radius, space } from '@/theme/tokens';
import { Unit, formatNumber, parseWeightInput } from '@/lib/units';

export interface DeviationTarget {
  exerciseId: string;
  exerciseName: string;
  index: number;
  targetWeightKg: number;
  targetReps: number;
  loggedWeightKg: number | null;
  loggedReps: string | null;
}

interface Props {
  target: DeviationTarget | null;
  unit: Unit;
  onSave: (weightKg: number, reps: number) => void;
  /** Vuelve a dejar el set exactamente como lo pautó el coach. */
  onReset: () => void;
  onClose: () => void;
}

export function DeviationSheet({ target, unit, onSave, onReset, onClose }: Props) {
  const [weightText, setWeightText] = useState('');
  const [reps, setReps] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!target) return;
    const startKg = target.loggedWeightKg ?? target.targetWeightKg;
    const startReps = parseInt(target.loggedReps ?? '', 10);
    setWeightText(formatNumber(startKg, unit));
    setReps(Number.isFinite(startReps) ? startReps : target.targetReps);
    setError(false);
  }, [target, unit]);

  function save() {
    if (!target) return;
    const kg = parseWeightInput(weightText, unit);
    if (kg == null || reps < 1) {
      setError(true);
      return;
    }
    onSave(kg, reps);
  }

  return (
    <Modal visible={target != null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <View style={styles.body}>
          <Text style={styles.title}>¿Qué pasó?</Text>
          <Text style={styles.subject}>
            {target?.exerciseName} · set {(target?.index ?? 0) + 1}
          </Text>

          <View style={styles.prescribed}>
            <Text style={styles.prescribedLabel}>TU COACH PAUTÓ</Text>
            <Text style={styles.prescribedValue}>
              {target ? `${formatNumber(target.targetWeightKg, unit)} ${unit} × ${target.targetReps}` : ''}
            </Text>
          </View>

          <Text style={styles.fieldLabel}>Repeticiones que conseguiste</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setReps((r) => Math.max(0, r - 1))}
              accessibilityRole="button"
              accessibilityLabel="Una repetición menos"
              style={({ pressed }) => [styles.step, pressed && styles.pressed]}
            >
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.reps}>{reps}</Text>
            <Pressable
              onPress={() => setReps((r) => Math.min(100, r + 1))}
              accessibilityRole="button"
              accessibilityLabel="Una repetición más"
              style={({ pressed }) => [styles.step, pressed && styles.pressed]}
            >
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>Peso que usaste ({unit})</Text>
          <TextInput
            value={weightText}
            onChangeText={(t) => {
              setWeightText(t);
              setError(false);
            }}
            keyboardType="decimal-pad"
            inputMode="decimal"
            returnKeyType="done"
            accessibilityLabel={`Peso usado en ${unit}`}
            style={[styles.input, error && styles.inputError]}
          />
          {error ? (
            <Text style={styles.error}>
              Escribe un peso válido y al menos una repetición.
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onReset}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Lo hice tal cual</Text>
          </Pressable>
          <Pressable
            onPress={save}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Guardar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,10,10,0.72)' },
  sheet: {
    backgroundColor: color.bgRaised,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    borderColor: color.border,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border,
    alignSelf: 'center',
    marginTop: space.md,
  },
  body: { padding: space.lg, gap: space.sm },
  title: { color: color.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  subject: { color: color.textMuted, fontSize: 13, marginTop: -6 },
  prescribed: {
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.chip,
    backgroundColor: color.bgSunken,
    borderLeftWidth: 3,
    borderLeftColor: color.accent,
    gap: 3,
  },
  prescribedLabel: { color: color.textFaint, fontSize: 10, letterSpacing: 2 },
  prescribedValue: {
    color: color.text,
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  fieldLabel: { color: palette.n400, fontSize: 12, marginTop: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  step: {
    width: 52,
    height: 52,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: color.text, fontSize: 22 },
  reps: {
    flex: 1,
    textAlign: 'center',
    color: color.text,
    fontSize: 30,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  input: {
    color: color.text,
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
  },
  inputError: { borderColor: color.accent },
  error: { color: color.accent, fontSize: 12 },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
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
