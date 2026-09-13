/**
 * Volumen semanal en hard sets: barras por semana, la actual en acento y el
 * deload en gris.
 *
 * La escala es una sola para todas las barras (la altura es proporcional al
 * máximo de la serie), así que cada barra se puede comparar con la de al lado.
 */

import { StyleSheet, Text, View } from 'react-native';
import { color, palette, radius, space } from '@/theme/tokens';

const CHART_HEIGHT = 76;

interface Props {
  /** Hard sets por semana. La última entrada es el deload. */
  weeks: number[];
  /** Índice 0-based de la semana en curso. */
  currentIndex: number;
}

export function VolumeChart({ weeks, currentIndex }: Props) {
  const max = Math.max(...weeks, 1);
  const lastIndex = weeks.length - 1;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>VOLUMEN SEMANAL · HARD SETS POR MÚSCULO</Text>

      <View style={styles.plot}>
        {weeks.map((v, i) => {
          const isDeload = i === lastIndex;
          const isNow = i === currentIndex;
          return (
            <View key={i} style={styles.column}>
              <View style={styles.barSlot}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(3, Math.round((v / max) * CHART_HEIGHT)),
                      backgroundColor: isDeload
                        ? palette.n700
                        : isNow
                          ? color.accent
                          : palette.a700,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.tick, isNow && styles.tickNow]}>
                {isDeload ? 'DL' : `S${i + 1}`}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: palette.a500 }]} />
          <Text style={styles.legendText}>Acumulación</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: palette.n700 }]} />
          <Text style={styles.legendText}>Deload</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 13,
    borderRadius: radius.card,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  label: { color: color.textMuted, fontSize: 10, letterSpacing: 2 },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 96,
    marginTop: space.md,
  },
  column: { flex: 1, alignItems: 'center', gap: 6 },
  barSlot: { width: '100%', height: CHART_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 1 },
  tick: { color: color.textFaint, fontSize: 9.5 },
  tickNow: { color: palette.a200, fontWeight: '600' },
  legend: {
    flexDirection: 'row',
    gap: 14,
    marginTop: space.md,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  legendText: { color: color.textMuted, fontSize: 11 },
});
