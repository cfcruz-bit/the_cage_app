/**
 * Ajustes. A diferencia del prototipo, aquí son valores reales: cambiar la
 * unidad o la agresividad replantea la sesión al instante y se guarda en la
 * base local.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { ApiError } from '@/api/client';
import { linkAthlete } from '@/api/endpoints';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { Aggressiveness, POLICY_VERSION } from '@cage/engine';
import { Screen } from '@/components/Screen';
import { Chip } from '@/components/Chip';
import { RecordsPanel } from '@/features/records/RecordsPanel';
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
  const signOut = useAuth((s) => s.signOut);
  // La agresividad la decide el atleta sobre su propia recuperación; el coach
  // pauta sets, reps, carga y descanso en el plan, no esto.
  const isAthlete = useApp((s) => s.role) === 'athlete';
  const user = useAuth((s) => s.user);

  /**
   * Cierra la sesión de verdad: revoca el refresh token en el servidor y borra
   * las credenciales del teléfono.
   *
   * NO borra la base local. Los sets que el atleta registró sin cobertura
   * siguen en la cola y tienen que sobrevivir a esto: lo que se pierde aquí es
   * la identidad, no el trabajo.
   */
  function exitRole() {
    void signOut().finally(() => {
      logout();
      router.replace('/login');
    });
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

        {isAthlete && user !== null && user !== undefined ? (
          <View style={styles.group}>
            <RecordsPanel athleteId={user.id} canEdit={false} />
          </View>
        ) : null}

        {!isAthlete ? <AddAthlete /> : null}

        <View style={styles.group}>
          <Text style={styles.groupTitle}>Cuenta</Text>
          {user !== null && user !== undefined ? (
            <Text style={styles.groupHelp}>
              {user.displayName} · {user.email}
            </Text>
          ) : null}
          <Pressable
            onPress={exitRole}
            accessibilityRole="button"
            style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Cerrar sesión</Text>
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
          {lineasDeVersion().map((linea) => (
            <Text key={linea} style={styles.aboutLine}>
              {linea}
            </Text>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * Qué versión está corriendo este teléfono.
 *
 * Sustituye al texto de "Fase 1 / la sincronización llega en la Fase 3" que
 * vivía aquí. Ese texto describía el estado del PROYECTO, y el proyecto avanzó
 * sin que nadie se acordara de actualizarlo: acabó afirmando que los datos no
 * salían del teléfono cuando llevaban días sincronizándose. Un texto fijo sobre
 * el estado del desarrollo siempre termina mintiendo con la autoridad de venir
 * de la propia app.
 *
 * Lo que sale ahora se calcula, así que no puede quedarse viejo, y es lo que
 * de verdad hace falta cuando un atleta escribe diciendo que algo no le
 * funciona: qué versión tiene y si recogió la última actualización. Sin esto
 * hay que adivinarlo preguntando.
 */
function lineasDeVersion(): string[] {
  const version = Constants.expoConfig?.version ?? '?';
  const lineas = [
    `The Cage 2.0 · v${version}`,
    `Política del motor ${POLICY_VERSION}`,
  ];

  if (!Updates.isEnabled) {
    // Expo Go y las builds de desarrollo no reciben actualizaciones por aire.
    lineas.push('Actualizaciones por aire: desactivadas (desarrollo)');
    return lineas;
  }

  const canal = Updates.channel ?? 'sin canal';

  if (Updates.isEmbeddedLaunch) {
    lineas.push(`Versión de fábrica del APK · canal ${canal}`);
  } else {
    lineas.push(`Actualizada ${fechaCorta(Updates.createdAt)} · canal ${canal}`);
  }

  // Los ocho primeros caracteres bastan para identificar la actualización en
  // el panel de Expo, y caben en una línea.
  const id = Updates.updateId;
  if (id !== null) lineas.push(`Actualización ${id.slice(0, 8)}`);

  return lineas;
}

/** dd/mm/aaaa hh:mm, sin depender del soporte de Intl del teléfono. */
function fechaCorta(fecha: Date | null): string {
  if (fecha === null) return 'en fecha desconocida';
  const dd = (n: number) => String(n).padStart(2, '0');
  return (
    `el ${dd(fecha.getDate())}/${dd(fecha.getMonth() + 1)}/${fecha.getFullYear()}` +
    ` a las ${dd(fecha.getHours())}:${dd(fecha.getMinutes())}`
  );
}

/**
 * Alta de un atleta en la cartera del coach.
 *
 * Se vincula por email a un atleta que YA tiene cuenta: el coach no crea
 * usuarios. Dejar que eligiera la contraseña de otra persona sería darle acceso
 * permanente a una cuenta que no es suya.
 */
function AddAthlete() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const submit = useCallback(async () => {
    const value = email.trim().toLowerCase();
    if (value.length === 0 || busy) return;

    setBusy(true);
    setMessage(null);
    try {
      const athlete = await linkAthlete(value);
      setEmail('');
      setFailed(false);
      setMessage(`${athlete.displayName} está ahora en tu cartera.`);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof ApiError
          ? error.offline
            ? 'Sin conexión con el servidor.'
            : error.status === 404
              ? 'No hay ningún atleta con ese email. Tiene que registrarse primero.'
              : error.message
          : 'No se pudo añadir.',
      );
    } finally {
      setBusy(false);
    }
  }, [email, busy]);

  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>Añadir atleta</Text>
      <Text style={styles.groupHelp}>
        Por su email. Tiene que haberse registrado ya en la app.
      </Text>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="atleta@email.com"
        placeholderTextColor={color.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        returnKeyType="go"
        editable={!busy}
        onSubmitEditing={() => void submit()}
        accessibilityLabel="Email del atleta"
      />

      <Pressable
        onPress={() => void submit()}
        disabled={busy || email.trim().length === 0}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.danger,
          (busy || email.trim().length === 0) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={color.textMuted} />
        ) : (
          <Text style={styles.secondaryText}>Añadir a mi cartera</Text>
        )}
      </Pressable>

      {message !== null ? (
        <Text style={[styles.groupHelp, failed && { color: color.accent }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.chip,
  },
  disabled: { opacity: 0.45 },
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
