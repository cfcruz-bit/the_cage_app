/**
 * Descanso entre series, con el tiempo que pautó el coach.
 *
 * Aparece al marcar un set, en el sitio del set activo, y cuenta hacia atrás
 * a un tamaño que se lee con el móvil en el suelo. El atleta puede saltarlo —el
 * cronómetro informa, no encierra— pero no puede cambiar la duración: eso lo
 * decide el coach en el plan.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { color, condensed, radius, space } from '@/theme/tokens';
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
  /** Lo que viene después: el siguiente set y su barra. */
  children?: ReactNode;
}

export function RestTimer({ seconds, runKey, onDismiss, children }: Props) {
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
    <View style={styles.block}>
      <View style={styles.head}>
        <Text style={styles.time}>{formatRest(Math.max(0, left))}</Text>
        <Text style={styles.label}>{done ? 'Descanso completo' : 'Descanso'}</Text>
      </View>
      <View style={styles.track}>
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
      </View>
      {children}
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        style={({ pressed }) => [styles.skip, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.skipText}>{done ? 'Siguiente set' : 'Saltar descanso'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: color.slam,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  label: { color: color.bone, opacity: 0.8, fontSize: 14 },
  time: {
    ...condensed,
    color: color.bone,
    fontSize: 72,
    lineHeight: 72,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.28)',
    overflow: 'hidden',
  },
  fill: { height: 6, backgroundColor: color.bone },
  skip: {
    backgroundColor: color.bone,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: radius.chip,
    marginTop: 2,
  },
  skipText: { ...condensed, color: color.onBone, fontSize: 22, letterSpacing: 0.5 },
});
