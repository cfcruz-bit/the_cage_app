/**
 * Selección de rol — la primera pantalla del prototipo.
 *
 * La coreografía de entrada es la del original: el logo se estampa, y luego
 * entran deslizándose desde la izquierda la etiqueta, las dos tarjetas y el pie,
 * escalonados. Al elegir rol, el rojo tapa la pantalla y la navegación ocurre
 * detrás, a los 300 ms, para que no se vea el cambio.
 *
 * En la Fase 2 esta pantalla pasa a ser el login real y el rol vendrá de
 * `GET /me`, pero la coreografía se mantiene.
 */

import { ReactNode, useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NAVIGATE_AT_MS } from '@/features/login/EnteringOverlay';
import { Role, ROLE_LABEL, useApp } from '@/stores/app';
import { color, palette, space } from '@/theme/tokens';

interface RoleOption {
  key: Role;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  edge: string;
  surface: string;
  delay: number;
}

// Los retardos son los del prototipo: el logo respira solo casi medio segundo
// antes de que aparezca nada más.
const ROLES: RoleOption[] = [
  {
    key: 'athlete',
    title: 'ATLETA',
    desc: 'Ejecuta tu meso y registra cada set',
    icon: 'barbell',
    edge: '#c2231b',
    surface: 'transparent',
    delay: 720,
  },
  {
    key: 'coach',
    title: 'COACH',
    desc: 'Programa mesos y revisa a tus clientes',
    icon: 'people',
    edge: palette.n700,
    surface: palette.raised,
    delay: 820,
  },
];

export default function LoginScreen() {
  const enter = useApp((s) => s.enter);
  const entering = useApp((s) => s.entering);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function pick(role: Role) {
    if (entering) return;
    enter(role);
    // El rojo ya está tapando; la app cambia de pantalla debajo, sin que se vea.
    timer.current = setTimeout(() => router.replace('/'), NAVIGATE_AT_MS);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <Reveal kind="stamp" delay={0} duration={620}>
          <Image
            source={require('../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="The Cage Barbell Club"
          />
        </Reveal>
      </View>

      <View style={styles.picker}>
        <Reveal kind="fade" delay={660}>
          <Text style={styles.eyebrow}>ENTRAR COMO</Text>
        </Reveal>

        {ROLES.map((r) => (
          <Reveal key={r.key} kind="slide" delay={r.delay}>
            <Pressable
              onPress={() => pick(r.key)}
              accessibilityRole="button"
              accessibilityLabel={`Entrar como ${ROLE_LABEL[r.key]}`}
              style={({ pressed }) => [
                styles.card,
                { borderLeftColor: r.edge, backgroundColor: r.surface },
                pressed && styles.cardPressed,
              ]}
            >
              <View style={styles.cardIcon}>
                <Ionicons
                  name={r.icon}
                  size={19}
                  color={r.key === 'athlete' ? color.accent : palette.n300}
                />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{r.title}</Text>
                <Text style={styles.cardDesc}>{r.desc}</Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={color.textFaint} />
            </Pressable>
          </Reveal>
        ))}

        <Reveal kind="fade" delay={900}>
          <Text style={styles.footnote}>
            El acceso coach requiere licencia activa ·{' '}
            <Text style={styles.footnoteLink}>Recuperar acceso</Text>
          </Text>
        </Reveal>
      </View>
    </SafeAreaView>
  );
}

type RevealKind = 'fade' | 'slide' | 'stamp';

/**
 * Entrada escalonada, en tres sabores:
 *   fade   — solo opacidad, para texto secundario.
 *   slide  — entra desde la izquierda. Es el `enterLeft` del prototipo.
 *   stamp  — cae desde 1.14× con rebote. Es el `plateStamp` del logo.
 *
 * Si el sistema pide movimiento reducido, todo aparece ya colocado.
 */
function Reveal({
  kind,
  delay,
  duration = 380,
  children,
}: {
  kind: RevealKind;
  delay: number;
  duration?: number;
  children: ReactNode;
}) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        v.setValue(1);
        return;
      }
      Animated.timing(v, {
        toValue: 1,
        duration,
        delay,
        easing: kind === 'stamp' ? Easing.out(Easing.back(1.6)) : Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });

    return () => {
      cancelled = true;
    };
  }, [v, delay, duration, kind]);

  const transform =
    kind === 'slide'
      ? [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }]
      : kind === 'stamp'
        ? [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.14, 1] }) }]
        : [];

  return <Animated.View style={{ opacity: v, transform }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg, paddingHorizontal: 26 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // El logo de la marca, con alfa: se compone sobre cualquier fondo.
  logo: { width: 250, height: 97 },

  picker: { flex: 0, paddingBottom: 64, gap: 9 },
  eyebrow: {
    color: color.textFaint,
    fontSize: 10,
    letterSpacing: 2.2,
    marginBottom: 9,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: color.border,
    borderLeftWidth: 4,
  },
  cardPressed: { borderColor: color.accent, backgroundColor: 'rgba(224,74,58,0.08)' },
  cardIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.n900,
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { color: color.text, fontSize: 16, fontWeight: '600', letterSpacing: 3 },
  cardDesc: { color: color.textMuted, fontSize: 11.5, lineHeight: 16 },
  footnote: {
    color: color.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 14,
  },
  footnoteLink: { color: color.accent },
});
