/**
 * Descanso entre series, con el tiempo que pautó el coach.
 *
 * Aparece al marcar un set y cuenta hacia atrás. El atleta puede saltarlo —el
 * cronómetro informa, no encierra— pero no puede cambiar la duración: eso lo
 * decide el coach en el plan.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { color, palette, radius, space } from '@/theme/tokens';
import { formatRest } from '@/lib/prescription';

// El setInterval muere con la app en segundo plano; la alarma la agenda el
// sistema para que suene aunque el atleta esté en otra aplicación.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Tono propio (assets/sounds, declarado en el plugin de app.json): el sonido
// por defecto es un pitido corto que no se oye con la música del gimnasio.
const SOUND = 'descanso.wav';
// Android fija el sonido de un canal al crearlo y no deja cambiarlo: tono
// nuevo = canal nuevo. El viejo ('rest') se borra para que no quede en Ajustes.
const CHANNEL = 'rest-alarm';
const ready = (async () => {
  if (Platform.OS === 'android') {
    await Notifications.deleteNotificationChannelAsync('rest').catch(() => {});
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Descanso entre series',
      importance: Notifications.AndroidImportance.MAX,
      sound: SOUND,
      vibrationPattern: [0, 400, 200, 400, 200, 400],
    });
  }
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
})().catch(() => false);

async function scheduleAlarm(seconds: number) {
  if (seconds <= 0 || !(await ready)) return null;
  return Notifications.scheduleNotificationAsync({
    content: { title: 'Descanso completo', body: 'A la siguiente serie.', sound: SOUND },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: CHANNEL,
    },
  });
}

interface Props {
  /** Duración pautada, en segundos. */
  seconds: number;
  /** Cambia en cada set marcado: reinicia la cuenta. */
  runKey: string | null;
  onDismiss: () => void;
}

export function RestTimer({ seconds, runKey, onDismiss }: Props) {
  const [left, setLeft] = useState(seconds);
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (runKey == null) return;

    setLeft(seconds);
    progress.setValue(1);
    Animated.timing(progress, {
      toValue: 0,
      duration: seconds * 1000,
      useNativeDriver: false,
    }).start();

    // Contamos contra el reloj, no sumando ticks: si el sistema retrasa el
    // intervalo, el número sigue siendo el correcto.
    const startedAt = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = seconds - elapsed;
      setLeft(remaining > 0 ? remaining : 0);
      if (remaining <= 0) clearInterval(id);
    }, 250);

    // Saltar, marcar otro set o salir de la pantalla desmonta el efecto y
    // cancela la alarma pendiente.
    const alarm = scheduleAlarm(seconds);

    return () => {
      clearInterval(id);
      alarm
        .then((n) => (n ? Notifications.cancelScheduledNotificationAsync(n) : undefined))
        .catch(() => {});
    };
  }, [runKey, seconds, progress]);

  if (runKey == null) return null;

  const done = left <= 0;

  return (
    <View style={styles.bar}>
      <Animated.View
        style={[
          styles.fill,
          {
            width: progress.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
      <View style={styles.content}>
        <Text style={styles.label}>{done ? 'DESCANSO COMPLETO' : 'DESCANSO'}</Text>
        <Text style={[styles.time, done && styles.timeDone]}>
          {formatRest(Math.max(0, left))}
        </Text>
        <View style={styles.spacer} />
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={done ? 'Cerrar' : 'Saltar descanso'}
          hitSlop={10}
          style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.skipText}>{done ? 'Cerrar' : 'Saltar'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    borderRadius: radius.card,
    backgroundColor: palette.n900,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  // Explícito a propósito: `StyleSheet.absoluteFillObject` no existe en React
  // Native 0.86 (solo `absoluteFill`), y al desaparecer dejaba el estilo sin
  // posicionamiento sin avisar de nada.
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(224,74,58,0.16)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  label: { color: color.textFaint, fontSize: 10, letterSpacing: 2 },
  time: {
    color: color.text,
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  timeDone: { color: color.accent },
  spacer: { flex: 1 },
  skip: { paddingHorizontal: space.sm, paddingVertical: 4 },
  skipText: { color: color.accent, fontSize: 13, fontWeight: '600' },
});
