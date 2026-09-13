import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EnteringOverlay } from '@/features/login/EnteringOverlay';
import { useApp } from '@/stores/app';
import { useSession } from '@/stores/session';
import { color } from '@/theme/tokens';

export default function RootLayout() {
  const ready = useSession((s) => s.ready);
  const hydrate = useSession((s) => s.hydrate);
  const entering = useApp((s) => s.entering);
  const clearEntering = useApp((s) => s.clearEntering);

  useEffect(() => {
    hydrate().catch((err) => {
      console.error('[cage] no se pudo abrir la base local:', err);
    });
  }, [hydrate]);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.loading}>
          <ActivityIndicator color={color.accent} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />

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

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
});
