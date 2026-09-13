/**
 * Transición de entrada al rol: el rojo cae de golpe, se estampa el rol, y se
 * retira dejando ver la app ya montada.
 *
 *   0 ms    el rojo TAPA, sin desvanecido. Es un golpe, no una cortina.
 *   0–280   el icono y el rol se estampan desde 1.3× con rebote.
 *   300     detrás, la app navega a las pestañas (lo hace login.tsx).
 *   540–800 el rojo se va escalando y desvaneciendo: revela, no parpadea.
 *
 * Va dentro de un Modal a propósito. Como vista absoluta dependía de que su
 * contenedor midiera la pantalla completa, y no la medía: acababa colocada como
 * un hijo más del layout, empujada abajo y con la altura de su contenido — una
 * franja roja en vez de una pantalla. El Modal cubre todo por definición,
 * independientemente del layout que tenga encima, y además bloquea los toques
 * sin que haya que pedirlo.
 */

import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, palette } from '@/theme/tokens';

/** Momento en el que la app de debajo ya debe haber cambiado de pantalla. */
export const NAVIGATE_AT_MS = 300;
const STAMP_MS = 280;
const HOLD_MS = 260;
const EXIT_MS = 260;

export function EnteringOverlay({ label, onDone }: { label: string; onDone: () => void }) {
  // El rojo arranca puesto: nada de aparecer poco a poco.
  const cover = useRef(new Animated.Value(1)).current;
  const stamp = useRef(new Animated.Value(0)).current;
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    let cancelled = false;

    function finish() {
      if (done.current || cancelled) return;
      done.current = true;
      onDone();
    }

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled) return;

        if (reduced) {
          // Con movimiento reducido se mantiene el corte —sigue marcando el
          // cambio de contexto— pero sin rebotes ni escalados.
          stamp.setValue(1);
          setTimeout(finish, NAVIGATE_AT_MS + HOLD_MS);
          return;
        }

        Animated.sequence([
          Animated.timing(stamp, {
            toValue: 1,
            duration: STAMP_MS,
            easing: Easing.out(Easing.back(2.2)),
            useNativeDriver: true,
          }),
          Animated.delay(HOLD_MS),
          Animated.timing(cover, {
            toValue: 0,
            duration: EXIT_MS,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(finish);
      })
      .catch(finish);

    // Si algo interrumpe la animación, el rojo no se queda pegado para siempre.
    const failsafe = setTimeout(finish, STAMP_MS + HOLD_MS + EXIT_MS + 600);

    return () => {
      cancelled = true;
      clearTimeout(failsafe);
    };
  }, [cover, stamp, onDone]);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      // Android exige el prop; aquí no se cierra a mano, se cierra sola.
      onRequestClose={() => {}}
    >
      <Animated.View
        style={[
          styles.cover,
          {
            opacity: cover,
            // Al salir, el rojo se abre hacia fuera en vez de desvanecerse plano.
            transform: [
              { scale: cover.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] }) },
            ],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.stamp,
            {
              opacity: stamp,
              transform: [
                { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [1.3, 1] }) },
              ],
            },
          ]}
        >
          <Ionicons name="barbell" size={34} color={palette.a100} />
          <Text style={styles.label} accessibilityRole="header">
            {label}
          </Text>
          <Text style={styles.club}>THE CAGE BARBELL CLUB</Text>
        </Animated.View>

        <View style={styles.rule} />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // flex: 1 dentro del Modal — ocupa la pantalla sin depender de posicionamiento.
  cover: {
    flex: 1,
    backgroundColor: color.slam,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stamp: { alignItems: 'center' },
  label: {
    color: palette.a100,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 4.2,
    marginTop: 8,
  },
  club: {
    color: palette.a100,
    fontSize: 10.5,
    letterSpacing: 3,
    marginTop: 4,
    opacity: 0.72,
  },
  rule: {
    position: 'absolute',
    bottom: 72,
    width: 46,
    height: 2,
    backgroundColor: palette.a100,
    opacity: 0.35,
  },
});
