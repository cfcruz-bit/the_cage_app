import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { chipStyle, color, radius, space } from '@/theme/tokens';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

/** Chip seleccionable. El patrón visual más repetido de la app. */
export const Chip = memo(function Chip({ label, active, onPress }: Props) {
  const s = chipStyle(active);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: s.backgroundColor, borderColor: s.borderColor },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, { color: s.color }]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.chip,
  },
  pressed: { opacity: 0.6 },
  label: { fontSize: 13, fontWeight: '500' },
});
