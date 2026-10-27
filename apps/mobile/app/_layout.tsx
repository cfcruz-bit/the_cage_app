import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { type ErrorBoundaryProps, Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  ChangePasswordGate,
  ExpiredGate,
  RenewalBanner,
} from '@/features/account/Gate';
import { EnteringOverlay } from '@/features/login/EnteringOverlay';
import { useApp } from '@/stores/app';
import { useAuth, refreshProfile } from '@/stores/auth';
import { useSession } from '@/stores/session';
import { useAutoSync } from '@/sync/useAutoSync';
import { color, condensed, radius, space, statusBarStyle } from '@/theme/tokens';

export default function RootLayout() {
  const ready = useSession((s) => s.ready);
  const hydrate = useSession((s) => s.hydrate);
  const entering = useApp((s) => s.entering);
  const clearEntering = useApp((s) => s.clearEntering);
  const adopt = useApp((s) => s.adopt);

  const user = useAuth((s) => s.user);
  const restore = useAuth((s) => s.restore);

  useEffect(() => {
    hydrate().catch((err) => {
      console.error('[cage] no se pudo abrir la base local:', err);
    });
  }, [hydrate]);

  // La sesión se restaura desde SecureStore, sin red: abrir la app y entrenar
  // no puede depender de la cobertura.
  useEffect(() => {
    void restore();
  }, [restore]);

  // El rol de la app SIEMPRE sale de la cuenta. Si la sesión caducó o se cerró
  // desde otro dispositivo, esto devuelve a la pantalla de login.
  //
  // Un administrador no tiene sitio aquí: administra desde la página web. Si
  // entrara con su cuenta, la app lo trata como si no hubiera sesión.
  //
  // Depende de quién es y qué rol tiene, no del objeto `user`: refreshProfile
  // guarda un objeto nuevo, y con `user` como dependencia se volvía a llamar a
  // sí mismo en bucle (decenas de /auth/me seguidos al entrar).
  const who = user === undefined ? undefined : user === null ? null : `${user.id}:${user.role}`;
  useEffect(() => {
    const current = useAuth.getState().user;
    if (current === undefined) return;
    adopt(current === null || current.role === 'admin' ? null : current.role);
    if (current !== null) void refreshProfile();
  }, [who, adopt]);

  // La cola se vacía sola mientras haya sesión.
  useAutoSync(user != null);

  // `user === undefined` significa que todavía no se ha mirado SecureStore.
  // Sin esta espera, la app parpadearía en /login antes de entrar.
  if (!ready || user === undefined) {
    return (
      <SafeAreaProvider>
        <StatusBar style={statusBarStyle} />
        <View style={styles.loading}>
          <ActivityIndicator color={color.accent} />
        </View>
      </SafeAreaProvider>
    );
  }

  // Dos estados en los que la app no sirve para nada más, así que ocupan la
  // pantalla entera en vez de ser un aviso que se pueda ignorar.
  if (user !== null) {
    if (user.mustChangePassword) {
      return (
        <SafeAreaProvider>
          <StatusBar style={statusBarStyle} />
          <ChangePasswordGate />
        </SafeAreaProvider>
      );
    }
    if (expired(user)) {
      return (
        <SafeAreaProvider>
          <StatusBar style={statusBarStyle} />
          <ExpiredGate endedOn={user.accessEndsOn} />
        </SafeAreaProvider>
      );
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={statusBarStyle} />

      {user !== null && user.renewalWarning && user.daysLeft !== null ? (
        <RenewalBanner daysLeft={user.daysLeft} />
      ) : null}

      {/* Quién puede estar en cada ruta lo decide el layout de cada grupo:
          (tabs) redirige a /login si no hay rol, y login navega a / al elegirlo. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      </Stack>

      {entering ? <EnteringOverlay label={entering} onDone={clearEntering} /> : null}
    </SafeAreaProvider>
  );
}

/**
 * Acceso vencido.
 *
 * `daysLeft` en null junto a un rol que SÍ caduca es la señal: el servidor
 * devuelve null cuando hoy no cae dentro de ningún periodo pagado. Para coach
 * y admin, `accessEndsOn` también es null y por eso se comprueban los dos.
 */
function expired(user: { role: string; accessEndsOn: string | null; daysLeft: number | null }): boolean {
  if (user.role !== 'athlete') return false;
  return user.daysLeft === null;
}

/**
 * Si una pantalla revienta al dibujarse, esto ocupa su lugar en vez de cerrar
 * la app. Lo marcado ya está en SQLite y en la cola de subida, así que
 * reintentar no pierde nada.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error('[cage] una pantalla falló al dibujarse:', error);
  }, [error]);

  return (
    <SafeAreaProvider>
      <StatusBar style={statusBarStyle} />
      <View style={styles.error}>
        <Text style={styles.errorTitle}>Esta pantalla no cargó</Text>
        <Text style={styles.errorBody}>Los sets que marcaste están guardados en el teléfono.</Text>
        <Pressable
          onPress={() => void retry()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            router.replace('/');
            void retry();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.home, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.homeText}>Volver al inicio</Text>
        </Pressable>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
  error: {
    flex: 1,
    backgroundColor: color.bg,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  errorTitle: { color: color.text, fontSize: 20, fontWeight: '600' },
  errorBody: { color: color.textMuted, fontSize: 15, lineHeight: 21 },
  retry: {
    backgroundColor: color.bone,
    minHeight: 48,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  retryText: { ...condensed, color: color.onBone, fontSize: 22, letterSpacing: 0.5 },
  home: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  homeText: { color: color.textMuted, fontSize: 15 },
});
