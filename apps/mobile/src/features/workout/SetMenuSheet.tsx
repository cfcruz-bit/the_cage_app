/**
 * Menú de set: acciones y tipo de set.
 *
 * Myorep y Myorep Match aparecen aquí como en el prototipo, pero **no están
 * implementados en el motor**. Se marcan como próximamente en vez de fingir que
 * funcionan: introducen mini-sets anidados y eso cambia la forma de set_logs,
 * así que hay que definirlos en el dominio antes de dibujar su comportamiento.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, palette, radius, space } from '@/theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAddSet: () => void;
  onSkipSet: () => void;
  onDeleteSet: () => void;
}

const ACTIONS = [
  { key: 'add', label: 'Añadir set abajo', icon: 'add-circle-outline' },
  { key: 'skip', label: 'Skip set', icon: 'play-skip-forward-outline' },
  { key: 'delete', label: 'Eliminar set', icon: 'trash-outline', danger: true },
] as const;

const SET_TYPES = [
  { mark: '✓', label: 'Regular', desc: 'Straight, down o ascending', ready: true },
  { mark: 'M', label: 'Myorep', desc: 'Set activador + mini-sets', ready: false },
  { mark: 'MM', label: 'Myorep Match', desc: 'Igualar reps efectivas', ready: false },
] as const;

export function SetMenuSheet({ visible, onClose, onAddSet, onSkipSet, onDeleteSet }: Props) {
  const handlers: Record<string, () => void> = {
    add: onAddSet,
    skip: onSkipSet,
    delete: onDeleteSet,
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.menu}>
          <Text style={styles.section}>SET</Text>
          {ACTIONS.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => {
                handlers[a.key]?.();
                onClose();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <Ionicons
                name={a.icon}
                size={16}
                color={'danger' in a && a.danger ? color.danger : color.text}
              />
              <Text
                style={[styles.itemLabel, 'danger' in a && a.danger && { color: color.danger }]}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}

          <Text style={[styles.section, styles.sectionDivided]}>SET TYPE</Text>
          {SET_TYPES.map((t) => (
            <Pressable
              key={t.label}
              onPress={onClose}
              disabled={!t.ready}
              accessibilityRole="button"
              accessibilityState={{ disabled: !t.ready }}
              style={({ pressed }) => [
                styles.type,
                pressed && t.ready && styles.pressed,
                !t.ready && styles.typeDisabled,
              ]}
            >
              <Text style={styles.typeMark}>{t.mark}</Text>
              <View style={styles.typeText}>
                <Text style={styles.typeLabel}>
                  {t.label}
                  {t.ready ? '' : '  · próximamente'}
                </Text>
                <Text style={styles.typeDesc}>{t.desc}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(10,10,10,0.72)',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  menu: {
    width: 252,
    borderRadius: radius.card,
    backgroundColor: palette.n900,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
    paddingBottom: 6,
  },
  section: {
    color: color.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    paddingHorizontal: 13,
    paddingTop: 9,
    paddingBottom: 5,
  },
  sectionDivided: { borderTopWidth: 1, borderTopColor: palette.n800, marginTop: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  itemLabel: { color: color.text, fontSize: 13.5 },
  pressed: { backgroundColor: 'rgba(224,74,58,0.12)' },
  type: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  typeDisabled: { opacity: 0.45 },
  typeMark: { width: 18, color: color.accent, fontSize: 12, fontWeight: '600' },
  typeText: { flex: 1 },
  typeLabel: { color: color.text, fontSize: 13.5 },
  typeDesc: { color: color.textFaint, fontSize: 10.5 },
});
