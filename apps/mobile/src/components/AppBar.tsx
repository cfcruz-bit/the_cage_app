import { StyleSheet, Text, View } from 'react-native';
import { color, space } from '@/theme/tokens';

/**
 * Barra de marca: el tick rojo, "The Cage · Barbell Club" y el rol a la
 * derecha. Está en todas las pantallas de la app en el prototipo.
 */
export function AppBar({ roleLabel }: { roleLabel: string }) {
  return (
    <View style={styles.bar}>
      <View style={styles.brand}>
        <View style={styles.tick} />
        <Text style={styles.name}>THE CAGE</Text>
        <Text style={styles.club}>BARBELL CLUB</Text>
      </View>
      <Text style={styles.role}>{roleLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },
  tick: { width: 3, height: 16, backgroundColor: '#c2231b' },
  name: { color: color.text, fontSize: 14, fontWeight: '700', letterSpacing: 3.2 },
  club: { color: color.textFaint, fontSize: 8.5, letterSpacing: 1.7 },
  role: { color: color.textFaint, fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase' },
});
