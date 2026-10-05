/**
 * La barra cargada: los discos de un lado, en sus colores reales.
 *
 * Ahorra la cuenta mental entre series. No pinta nada si es la barra sola (no
 * hay cuenta que ahorrar) ni si la carga no se puede montar exacta con los
 * discos que conoce.
 */

import { StyleSheet, Text, View } from 'react-native';
import { type PlateKg, platesPerSide } from '@/lib/plates';
import { color, plate, space } from '@/theme/tokens';

/** Ancho y alto de cada disco: más pesado, más grande. */
const SIZE: Record<PlateKg, { width: number; height: number }> = {
  25: { width: 10, height: 44 },
  20: { width: 10, height: 44 },
  15: { width: 9, height: 40 },
  10: { width: 7, height: 34 },
  5: { width: 6, height: 26 },
  2.5: { width: 5, height: 20 },
  1.25: { width: 4, height: 16 },
};

export function LoadedBar({ kg }: { kg: number }) {
  const plates = platesPerSide(kg);
  if (plates === null || plates.length === 0) return null;

  const text = `${plates.join(' + ')} por lado`;

  return (
    <View style={styles.rack} accessible accessibilityLabel={`Discos: ${text}`}>
      <View style={styles.bar}>
        <View style={styles.shaft} />
        <View style={styles.collar} />
        {plates.map((p, i) => (
          <View key={i} style={[styles.plate, SIZE[p], { backgroundColor: plate[p] }]} />
        ))}
        <View style={styles.sleeve} />
      </View>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Siempre sobre negro: los discos rojos se perderían sobre el rojo del set activo.
  rack: {
    alignSelf: 'flex-start',
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 6,
    paddingHorizontal: space.md,
  },
  bar: { flexDirection: 'row', alignItems: 'center', height: 44 },
  shaft: { width: 22, height: 4, backgroundColor: plate.steel },
  collar: { width: 5, height: 16, backgroundColor: plate.steel, borderRadius: 1 },
  plate: { borderRadius: 2, marginLeft: 2 },
  sleeve: { width: 12, height: 7, backgroundColor: plate.steel, marginLeft: 2 },
  text: { flexShrink: 1, color: color.textMuted, fontSize: 12.5, fontVariant: ['tabular-nums'] },
});
