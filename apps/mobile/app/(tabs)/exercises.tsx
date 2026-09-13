/**
 * Biblioteca de ejercicios: filtro por músculo y buscador.
 *
 * El buscador usa `useDeferredValue`: la caja de texto responde a cada tecla,
 * pero el filtrado de la lista se hace en una actualización de menor prioridad.
 * Es el arreglo directo del hallazgo H-03 del prototipo, donde cada tecla
 * recalculaba el modelo de vista completo.
 */

import { useDeferredValue, useMemo } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Chip } from '@/components/Chip';
import { LIBRARY, MUSCLE_FILTERS } from '@/data/library';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { color, radius, space } from '@/theme/tokens';
import { formatLoad } from '@/lib/units';

export default function ExercisesScreen() {
  const unit = useSession((s) => s.unit);
  const filter = useUi((s) => s.filter);
  const query = useUi((s) => s.query);
  const setFilter = useUi((s) => s.setFilter);
  const setQuery = useUi((s) => s.setQuery);

  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return LIBRARY.filter(
      (l) =>
        (filter === 'Todos' || l.group === filter) &&
        (q === '' || `${l.name} ${l.equipment}`.toLowerCase().includes(q)),
    );
  }, [filter, deferredQuery]);

  return (
    <Screen title="Ejercicios" subtitle={`${results.length} de ${LIBRARY.length}`}>
      <View style={styles.controls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por nombre o material"
          placeholderTextColor={color.textFaint}
          autoCorrect={false}
          accessibilityLabel="Buscar ejercicio"
          style={styles.search}
        />
        <View style={styles.filters}>
          {MUSCLE_FILTERS.map((f) => (
            <Chip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.empty}>
            Ningún ejercicio coincide. Prueba con otro filtro o borra la búsqueda.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.equipment}</Text>
            </View>
            <View style={styles.best}>
              <Text style={styles.bestLabel}>Mejor</Text>
              <Text style={styles.bestValue}>{formatLoad(item.bestKg, unit)}</Text>
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
  best: { alignItems: 'flex-end', gap: 2 },
  bestLabel: { color: color.textFaint, fontSize: 9, letterSpacing: 1.6, fontWeight: '600' },
  bestValue: { color: color.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { color: color.textMuted, fontSize: 13, paddingVertical: space.xl, textAlign: 'center' },
});
