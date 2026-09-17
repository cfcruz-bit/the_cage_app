/**
 * Catálogo de ejercicios.
 *
 * Los 50 del servidor, no los del prototipo. El coach ve además los que creó
 * él; el atleta, solo los del sistema — el catálogo es material de trabajo del
 * coach, y dejar que cada atleta invente ejercicios lo llenaría de duplicados
 * en una semana.
 *
 * El buscador usa `useDeferredValue`: la caja responde a cada tecla, pero el
 * filtrado se hace en una actualización de menor prioridad. Es el arreglo del
 * hallazgo H-03 del prototipo, donde cada tecla recalculaba la vista entera.
 */

import { useCallback, useDeferredValue, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { listExercises } from '@/api/endpoints';
import type { ExerciseCatalogOut } from '@/api/types';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { MUSCLE_ORDER, groupByMuscle, muscleLabel } from '@/lib/muscles';
import { useRemote } from '@/lib/remote';
import { useUi } from '@/stores/ui';
import { color, radius, space } from '@/theme/tokens';

const ALL = 'Todos';

export default function ExercisesScreen() {
  const remote = useRemote<ExerciseCatalogOut[]>(
    useCallback(() => listExercises(), []),
    [],
  );

  const filter = useUi((s) => s.filter);
  const query = useUi((s) => s.query);
  const setFilter = useUi((s) => s.setFilter);
  const setQuery = useUi((s) => s.setQuery);

  const deferredQuery = useDeferredValue(query);
  const all = useMemo(() => remote.data ?? [], [remote.data]);

  /** Solo los músculos que de verdad tienen ejercicios. */
  const filters = useMemo(() => {
    const present = new Set(all.map((e) => e.muscle));
    return [ALL, ...MUSCLE_ORDER.filter((m) => present.has(m))];
  }, [all]);

  const sections = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const matching = all.filter(
      (e) =>
        (filter === ALL || e.muscle === filter) &&
        (q === '' ||
          `${e.name} ${e.equipment} ${muscleLabel(e.muscle)}`
            .toLowerCase()
            .includes(q)),
    );
    return groupByMuscle(matching).map((g) => ({ title: g.label, data: g.items }));
  }, [all, filter, deferredQuery]);

  const shown = useMemo(
    () => sections.reduce((n, s) => n + s.data.length, 0),
    [sections],
  );

  if (remote.loading && remote.data === null) {
    return (
      <Screen title="EJERCICIOS">
        <View style={styles.center}>
          <ActivityIndicator color={color.accent} />
        </View>
      </Screen>
    );
  }

  if (remote.data === null) {
    return (
      <Screen title="EJERCICIOS">
        <View style={styles.center}>
          <Ionicons
            name={remote.offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
            size={28}
            color={color.textFaint}
          />
          <Text style={styles.emptyTitle}>
            {remote.offline ? 'Sin conexión' : 'No se pudo cargar'}
          </Text>
          <Text style={styles.empty}>
            {remote.error ?? 'Inténtalo de nuevo.'}
          </Text>
          <Pressable
            onPress={remote.reload}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.empty}>Reintentar</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="EJERCICIOS" subtitle={`${shown} de ${all.length}`}>
      <View style={styles.controls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por nombre, material o músculo"
          placeholderTextColor={color.textFaint}
          autoCorrect={false}
          accessibilityLabel="Buscar ejercicio"
          style={styles.search}
        />
        <View style={styles.filters}>
          {filters.map((f) => (
            <Chip
              key={f}
              label={f === ALL ? ALL : muscleLabel(f)}
              active={filter === f}
              onPress={() => setFilter(f)}
            />
          ))}
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={remote.loading}
            onRefresh={remote.reload}
            tintColor={color.accent}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            Ningún ejercicio coincide. Probá con otro filtro o borrá la búsqueda.
          </Text>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.equipment}</Text>
            </View>
            {/* El rango y el RIR del catálogo son el punto de partida: lo que
                de verdad se entrena lo fija el coach en cada mesociclo. */}
            <View style={styles.spec}>
              <Text style={styles.specValue}>
                {item.repLo}–{item.repHi}
              </Text>
              <Text style={styles.specLabel}>REPS</Text>
            </View>
            <View style={styles.spec}>
              <Text style={styles.specValue}>{item.targetRir}</Text>
              <Text style={styles.specLabel}>RIR</Text>
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.md },
  search: {
    color: color.text,
    fontSize: 15,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    backgroundColor: color.bgRaised,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm },
  sectionTitle: {
    color: color.accent,
    fontSize: 10,
    letterSpacing: 2,
    marginTop: space.md,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
  },
  rowText: { flex: 1, gap: 2 },
  name: { color: color.text, fontSize: 15, fontWeight: '500' },
  meta: { color: color.textMuted, fontSize: 12 },
  spec: { alignItems: 'flex-end', gap: 2, minWidth: 40 },
  specLabel: { color: color.textFaint, fontSize: 9, letterSpacing: 1.6, fontWeight: '600' },
  specValue: {
    color: color.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xxl,
  },
  emptyTitle: { color: color.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  empty: { color: color.textMuted, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  retry: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: space.sm,
  },
});
