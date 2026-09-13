import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppBar } from './AppBar';
import { ROLE_LABEL, useApp } from '@/stores/app';
import { color, space } from '@/theme/tokens';

interface Props {
  title: string;
  subtitle?: string;
  /** Botón a la izquierda del título (volver, etc.). */
  leading?: ReactNode;
  /** Acción a la derecha del título. */
  trailing?: ReactNode;
  children: ReactNode;
}

/**
 * Contenedor común: barra de marca, cabecera y gutter lateral en un solo sitio.
 * Los títulos van en mayúsculas y con tracking, como en el prototipo.
 */
export function Screen({ title, subtitle, leading, trailing, children }: Props) {
  const role = useApp((s) => s.role);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBar roleLabel={role ? ROLE_LABEL[role] : ''} />

      <View style={styles.header}>
        {leading}
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {trailing}
      </View>

      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  headerText: { flex: 1, gap: 3 },
  title: { color: color.text, fontSize: 24, fontWeight: '700', letterSpacing: 0.5 },
  subtitle: { color: color.textMuted, fontSize: 12 },
});
