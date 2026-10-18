import { Redirect, Tabs } from 'expo-router';
import { type ColorValue, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/stores/app';
import { color } from '@/theme/tokens';

/**
 * Las pestañas cambian según el rol: el atleta entra por su sesión, el coach
 * por su lista de clientes. Las pestañas ocultas se marcan con `href: null`,
 * que las quita de la barra sin sacar la ruta del router.
 */
export default function TabsLayout() {
  const role = useApp((s) => s.role);
  if (role == null) return <Redirect href="/login" />;

  const isCoach = role === 'coach';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Activa en hueso con la marca roja encima, como el set activo.
        tabBarActiveTintColor: color.bone,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: { backgroundColor: color.bg, borderTopColor: color.border },
        tabBarLabelStyle: { fontSize: 12 },
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clientes',
          href: isCoach ? '/clients' : null,
          tabBarIcon: ({ color: c, size, focused }) => (
            <TabIcon name="people-outline" color={c} size={size} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          // El coach entra aquí a pautar; el atleta, a entrenar.
          title: isCoach ? 'Plan' : 'Entreno',
          tabBarIcon: ({ color: c, size, focused }) => (
            <TabIcon name="barbell-outline" color={c} size={size} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="mesos"
        options={{
          title: isCoach ? 'Bloques' : 'Bloque',
          tabBarIcon: ({ color: c, size, focused }) => (
            <TabIcon name="trending-up-outline" color={c} size={size} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: 'Ejercicios',
          tabBarIcon: ({ color: c, size, focused }) => (
            <TabIcon name="list-outline" color={c} size={size} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color: c, size, focused }) => (
            <TabIcon name="options-outline" color={c} size={size} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

/** El icono de la pestaña, con la marca roja encima cuando está activa. */
function TabIcon({
  name,
  color: c,
  size,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: ColorValue;
  size: number;
  focused: boolean;
}) {
  return (
    <View style={styles.icon}>
      {focused ? <View style={styles.mark} /> : null}
      <Ionicons name={name} size={size} color={c} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center' },
  mark: { position: 'absolute', top: -8, width: 22, height: 3, backgroundColor: color.slam },
});
