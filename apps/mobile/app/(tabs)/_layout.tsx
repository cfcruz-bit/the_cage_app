import { Redirect, Tabs } from 'expo-router';
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
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.textFaint,
        tabBarStyle: { backgroundColor: color.bg, borderTopColor: color.border },
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clientes',
          href: isCoach ? '/clients' : null,
          tabBarIcon: ({ color: c, size }) => <Ionicons name="people-outline" size={size} color={c} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          // El coach entra aquí a pautar; el atleta, a entrenar.
          title: isCoach ? 'Plan' : 'Workout',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="barbell-outline" size={size} color={c} />,
        }}
      />
      <Tabs.Screen
        name="mesos"
        options={{
          title: 'Mesos',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="trending-up-outline" size={size} color={c} />,
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: 'Ejercicios',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="list-outline" size={size} color={c} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="options-outline" size={size} color={c} />,
        }}
      />
    </Tabs>
  );
}
