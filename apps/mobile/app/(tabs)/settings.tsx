/**
 * Ajustes. A diferencia del prototipo, aquí son valores reales: cambiar la
 * unidad o la agresividad replantea la sesión al instante y se guarda en la
 * base local.
 */

import { Alert, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '@/stores/app';
import { Aggressiveness, POLICY_VERSION } from '@cage/engine';
import { Screen } from '@/components/Screen';
import { Chip } from '@/components/Chip';
import { useSession } from '@/stores/session';
import { color, radius, space } from '@/theme/tokens';
import type { Unit } from '@/lib/units';

const UNITS: { value: Unit; label: string }[] = [
  { value: 'kg', label: 'Kilogramos' },
  { value: 'lb', label: 'Libras' },
];

const AGGRESSIVENESS: Aggressiveness[] = ['Baja', 'Media', 'Alta'];

const AGGRESSIVENESS_HELP: Record<Aggressiveness, string> = {
  Baja: 'Sube la carga a la mitad de ritmo. Útil si vienes de una lesión o de un parón.',
  Media: 'Un escalón de carga por cada señal de progresión. El ajuste por defecto.',
  Alta: 'Multiplica los saltos por 1.5. Solo si recuperas bien y tienes margen de técnica.',
};

export default function SettingsScreen() {
  const unit = useSession((s) => s.unit);
  const aggressiveness = useSession((s) => s.aggressiveness);
  const setUnit = useSession((s) => s.setUnit);
  const setAggressiveness = useSession((s) => s.setAggressiveness);
  const clearSession = useSession((s) => s.clearSession);
  const logout = useApp((s) => s.logout);
  // La agresividad la decide el atleta sobre su propia recuperación; el coach
  // pauta sets, reps, carga y descanso en el plan, no esto.
  const isAthlete = useApp((s) => s.role) === 'athlete';

  function exitRole() {
    logout();
    router.replace('/login');
  }

  function confirmClear() {
    Alert.alert(
      'Borrar la sesión',
      'Se eliminan los sets registrados y el feedback de hoy. Los ejercicios se mantienen.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: () => void clearSession() },
      ],
    );
  }

  return (
    <Screen title="AJUSTES">
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Unidades</Text>
          <Text style={styles.groupHelp}>
            Solo cambia lo que ves. Tu historial se guarda siempre en kilogramos.
          </Text>
          <View style={styles.options}>
            {UNITS.map((u) => (
              <Chip
                key={u.value}
                label={u.label}
                active={unit === u.value}
                onPress={() => void setUnit(u.value)}
              />
            ))}
          </View>
        </View>

        {isAthlete ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>Agresividad del autoajuste</Text>
            <Text style={styles.groupHelp}>{AGGRESSIVENESS_HELP[aggressiveness]}</Text>
            <View style={styles.options}>
              {AGGRESSIVENESS.map((a) => (
                <Chip
                  key={a}
                  label={a}
                  active={aggressiveness === a}
                  onPress={() => void setAggressiveness(a)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.group}>
          <Text style={styles.groupTitle}>Cuenta</Text>
          <Pressable
            onPress={exitRole}
            accessibilityRole="button"
            style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Cambiar de rol</Text>
          </Pressable>
        </View>

        <View style={styles.group}>
          <Text style={styles.groupTitle}>Desarrollo</Text>
          <Pressable
            onPress={confirmClear}
            accessibilityRole="button"
            style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
          >
            <Text style={styles.dangerText}>Borrar la sesión de hoy</Text>
          </Pressable>
        </View>

        <View style={styles.about}>
          <Text style={styles.aboutLine}>The Cage 2.0 · Fase 1</Text>
          <Text style={styles.aboutLine}>Política del motor {POLICY_VERSION}</Text>
          <Text style={styles.aboutLine}>
            Sin conexión: todo se guarda en este teléfono. La sincronización llega en la Fase 3.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, paddingTop: 0, gap: space.xl, paddingBottom: space.xxl },
  group: { gap: space.sm },
  groupTitle: { color: color.text, fontSize: 15, fontWeight: '600' },
  groupHelp: { color: color.textMuted, fontSize: 12, lineHeight: 18 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 2 },
  danger: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    alignSelf: 'flex-start',
  },
  dangerText: { color: color.danger, fontSize: 14, fontWeight: '500' },
  secondaryText: { color: color.text, fontSize: 14, fontWeight: '500' },
  pressed: { opacity: 0.6 },
  about: {
    gap: 4,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  aboutLine: { color: color.textFaint, fontSize: 12, lineHeight: 18 },
});
