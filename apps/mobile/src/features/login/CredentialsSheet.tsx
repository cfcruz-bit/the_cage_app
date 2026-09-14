/**
 * Credenciales, detrás de la tarjeta de rol.
 *
 * La pantalla de roles es la del prototipo y no se toca: su coreografía y su
 * jerarquía se quedan como están. Esto es lo que faltaba debajo.
 *
 * Detalle que parece menor y no lo es: el rol que se tocó viaja a `signIn` y se
 * compara con el que devuelve el servidor. Si un atleta entra por COACH, se le
 * dice y se cierra la sesión. La app no decide roles —los comprueba—, porque
 * quien manda de verdad es la tabla `users` y los permisos de la API.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Role } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { color, palette, radius, space } from '@/theme/tokens';

/**
 * Solo hay dos puertas. El rol `admin` existe en el servidor pero no entra por
 * aquí: administra desde la página web, no desde la app de los atletas.
 */
const ROLE_TITLE: Record<Role, string> = {
  athlete: 'ATLETA',
  coach: 'COACH',
};

export function CredentialsSheet({
  role,
  onCancel,
  onSuccess,
}: {
  /** null = cerrada. */
  role: Role | null;
  onCancel: () => void;
  onSuccess: (role: Role) => void;
}) {
  const signIn = useAuth((s) => s.signIn);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const passwordRef = useRef<TextInput>(null);

  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (role === null) return;
    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [role, slide]);

  // Al cerrar se limpia la contraseña, nunca el email: repetir el correo en
  // cada intento es la clase de fricción que hace que la gente use una
  // contraseña más corta.
  useEffect(() => {
    if (role === null) {
      setPassword('');
      clearError();
    }
  }, [role, clearError]);

  if (role === null) return null;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit || role === null) return;
    const user = await signIn(email, password, role);
    if (user !== null) onSuccess(role);
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onCancel} accessible={false} />

        <Animated.View
          style={[
            styles.sheet,
            {
              opacity: slide,
              transform: [
                {
                  translateY: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.eyebrow}>ENTRAR COMO</Text>
            <Text style={styles.title}>{ROLE_TITLE[role]}</Text>
          </View>

          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="tu@email.com"
            placeholderTextColor={color.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            returnKeyType="next"
            editable={!busy}
            onSubmitEditing={() => passwordRef.current?.focus()}
            accessibilityLabel="Email"
          />

          <TextInput
            ref={passwordRef}
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Contraseña"
            placeholderTextColor={color.textFaint}
            autoCapitalize="none"
            autoComplete="current-password"
            secureTextEntry
            returnKeyType="go"
            editable={!busy}
            onSubmitEditing={() => void submit()}
            accessibilityLabel="Contraseña"
          />

          {error !== null ? (
            <View style={styles.error}>
              <Ionicons name="alert-circle" size={15} color={color.accent} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void submit()}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Entrar"
            style={({ pressed }) => [
              styles.submit,
              !canSubmit && styles.submitOff,
              pressed && canSubmit && styles.submitPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={color.onAccent} />
            ) : (
              <Text style={styles.submitText}>ENTRAR</Text>
            )}
          </Pressable>

          <Pressable
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <Text style={styles.cancel}>Volver</Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    backgroundColor: color.bgRaised,
    borderTopWidth: 1,
    borderTopColor: color.border,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: 26,
    paddingTop: space.xl,
    paddingBottom: 42,
    gap: space.md,
  },
  header: { gap: 2, marginBottom: space.xs },
  eyebrow: { color: color.textFaint, fontSize: 10, letterSpacing: 2.2 },
  title: { color: color.text, fontSize: 22, fontWeight: '600', letterSpacing: 3 },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: palette.n900,
    color: color.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  errorText: { color: color.accent, fontSize: 12.5, flex: 1, lineHeight: 17 },
  submit: {
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    marginTop: space.xs,
  },
  submitOff: { opacity: 0.4 },
  submitPressed: { backgroundColor: palette.accentEdge },
  submitText: {
    color: color.onAccent,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 3,
  },
  cancel: {
    color: color.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: space.sm,
  },
});
