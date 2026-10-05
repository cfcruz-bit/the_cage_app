/**
 * La barra cargada: los discos de un lado, en sus colores reales.
 *
 * Ahorra la cuenta mental entre series. No pinta nada si la carga no se puede
 * montar exacta con los discos que conoce.
 */

import { StyleSheet, Text, View } from 'react-native';
import { type PlateKg, platesPerSide } from '@/lib/plates';
import { color, plate, space } from '@/theme/tokens';

/** Ancho y alto de cada disco: más pesado, más grande. */
const SIZE: Record<PlateKg, { width: number; height: number }> = {
  25: { width: 13, height: 60 },
  20: { width: 13, height: 60 },
  15: { width: 11, height: 54 },
  10: { width: 9, height: 46 },
  5: { width: 7, height: 34 },
  2.5: { width: 6, height: 26 },
  1.25: { width: 5, height: 20 },
};

export function LoadedBar({ kg }: { kg: number }) {
  const plates = platesPerSide(kg);
  if (plates === null) return null;

  const text = plates.length === 0 ? 'Barra sola' : `${plates.join(' + ')} por lado`;

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
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    gap: 6,
  },
  bar: { flexDirection: 'row', alignItems: 'center', height: 60 },
  shaft: { width: 34, height: 5, backgroundColor: plate.steel },
  collar: { width: 7, height: 20, backgroundColor: plate.steel, borderRadius: 1 },
  plate: { borderRadius: 3, marginLeft: 2 },
  sleeve: { width: 16, height: 9, backgroundColor: plate.steel, marginLeft: 2 },
  text: { color: color.textMuted, fontSize: 12.5, fontVariant: ['tabular-nums'] },
});
