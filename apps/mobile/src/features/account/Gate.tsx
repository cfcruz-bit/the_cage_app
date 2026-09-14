/**
 * Las dos puertas que hay entre entrar y entrenar.
 *
 * 1. **Contraseña provisional sin cambiar.** El admin creó la cuenta y le dio
 *    una contraseña de doce caracteres. Hasta que la cambie, la API solo le
 *    deja hacer eso: es lo que consigue que el admin deje de conocer la
 *    contraseña de sus clientes.
 *
 * 2. **Acceso vencido.** El mes no está pagado. La app lo dice sin rodeos y
 *    sin ofrecer nada que el atleta pueda tocar, porque no hay nada que pueda
 *    hacer desde aquí: el cobro es presencial.
 *
 * Las dos son pantallas completas y no avisos, porque las dos son estados en
 * los que la app no sirve para nada más.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { changePassword } from '@/api/endpoints';
import { useAuth } from '@/stores/auth';
import { color, palette, space } from '@/theme/tokens';

/** Mismo mínimo que exige el servidor. */
const MIN_LENGTH = 10;

export function ChangePasswordGate() {
  const signOut = useAuth((s) => s.signOut);
  const restore = useAuth((s) => s.restore);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== next;
  const canSubmit =
    current.length > 0 && next.length >= MIN_LENGTH && next === repeat && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      // El servidor revoca las demás sesiones al cambiarla, la nuestra
      // incluida. Volver al login es la consecuencia, no un fallo.
      await signOut();
      await restore();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.offline
            ? 'Sin conexión con el servidor.'
            : e.message
          : 'No se pudo cambiar.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Ionicons name="key-outline" size={30} color={color.accent} />
        <Text style={styles.title}>ELEGÍ TU CONTRASEÑA</Text>
        <Text style={styles.help}>
          La que te dieron es provisional. Elegí una tuya para seguir: a partir
          de ahora solo la vas a saber vos.
        </Text>

        <TextInput
          style={styles.input}
          value={current}
          onChangeText={setCurrent}
          placeholder="Contraseña provisional"
          placeholderTextColor={color.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!busy}
          accessibilityLabel="Contraseña provisional"
        />
        <TextInput
          style={styles.input}
          value={next}
          onChangeText={setNext}
          placeholder={`Nueva contraseña (mínimo ${MIN_LENGTH})`}
          placeholderTextColor={color.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!busy}
          accessibilityLabel="Nueva contraseña"
        />
        <TextInput
          style={styles.input}
          value={repeat}
          onChangeText={setRepeat}
          placeholder="Repetir la nueva"
          placeholderTextColor={color.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!busy}
          onSubmitEditing={() => void submit()}
          accessibilityLabel="Repetir la nueva contraseña"
        />

        {tooShort ? <Text style={styles.hint}>Te faltan caracteres.</Text> : null}
        {mismatch ? <Text style={styles.hint}>No coinciden.</Text> : null}
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={() => void submit()}
          disabled={!canSubmit}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            !canSubmit && styles.off,
            pressed && canSubmit && styles.primaryPressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={color.onAccent} />
          ) : (
            <Text style={styles.primaryText}>GUARDAR</Text>
          )}
        </Pressable>

        <Pressable onPress={() => void signOut()} accessibilityRole="button">
          <Text style={styles.link}>Salir</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export function ExpiredGate({ endedOn }: { endedOn: string | null }) {
  const signOut = useAuth((s) => s.signOut);
  const restore = useAuth((s) => s.restore);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Ionicons name="lock-closed-outline" size={30} color={color.accent} />
        <Text style={styles.title}>NECESITA RENOVAR SU PAGO</Text>
        <Text style={styles.help}>
          {endedOn === null
            ? 'Tu acceso no está activo. Hablá con tu entrenador para renovarlo.'
            : `Tu acceso terminó el ${formatDate(endedOn)}. Hablá con tu entrenador para renovarlo.`}
        </Text>
        <Text style={styles.helpFaint}>
          Tu historial y tus mesociclos siguen guardados. En cuanto renueves,
          entrás donde lo dejaste.
        </Text>

        <Pressable
          onPress={() => {
            void restore();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
        >
          <Text style={styles.primaryText}>YA RENOVÉ</Text>
        </Pressable>

        <Pressable onPress={() => void signOut()} accessibilityRole="button">
          <Text style={styles.link}>Salir</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** Aviso de que queda poco. No bloquea nada: solo informa. */
export function RenewalBanner({ daysLeft }: { daysLeft: number }) {
  return (
    <View style={styles.banner}>
      <Ionicons name="time-outline" size={14} color={palette.a300} />
      <Text style={styles.bannerText}>
        {daysLeft <= 1
          ? 'Tu acceso termina hoy.'
          : `Te quedan ${daysLeft} días de acceso.`}
      </Text>
    </View>
  );
}

/** "2026-10-13" → "13 de octubre". Sin librerías de fechas por una línea. */
function formatDate(iso: string): string {
  const parts = iso.split('-');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return iso;
  return `${day} de ${MONTHS[month - 1] ?? ''}`.trim();
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
    gap: space.md,
  },
  title: {
    color: color.text,
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: 2.4,
    marginTop: space.sm,
  },
  help: { color: color.textMuted, fontSize: 14, lineHeight: 21 },
  helpFaint: { color: color.textFaint, fontSize: 12.5, lineHeight: 19 },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: palette.n900,
    color: color.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  hint: { color: color.textMuted, fontSize: 12.5 },
  error: { color: color.accent, fontSize: 12.5, lineHeight: 18 },
  primary: {
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    marginTop: space.sm,
  },
  primaryPressed: { backgroundColor: palette.accentEdge },
  off: { opacity: 0.4 },
  primaryText: {
    color: color.onAccent,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 3,
  },
  link: {
    color: color.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: space.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: palette.a900,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  bannerText: { color: palette.a300, fontSize: 12.5, flex: 1 },
});
