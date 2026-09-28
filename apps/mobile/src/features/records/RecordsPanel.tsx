/**
 * Marcas de fuerza (1RM) de un atleta.
 *
 * Es el número del que salen todos los pesos de un bloque programado por
 * porcentaje (bloque 3). El coach la registra desde la ficha del atleta; el
 * atleta la lee desde su perfil, sin botón para tocarla — es la misma regla
 * de toda la API: el atleta reporta lo que hizo, no pauta lo que hará.
 *
 * El selector de ejercicio filtra a BÁSICOS por defecto: es donde vive el
 * 1RM real, y es del único grupo del que hoy se pautan porcentajes.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from '@/api/client';
import { createRecord, deleteRecord, listExercises, listRecords } from '@/api/endpoints';
import type { ExerciseCatalogOut, OneRepMaxOut, OneRepMaxSource } from '@/api/types';
import { groupByMuscle } from '@/lib/muscles';
import { useRemote } from '@/lib/remote';
import { formatLoad } from '@/lib/units';
import { useSession } from '@/stores/session';
import { color, palette, radius, space } from '@/theme/tokens';

const SOURCE_LABEL: Record<OneRepMaxSource, string> = {
  test: 'Test',
  competicion: 'Competición',
  estimada: 'Estimada',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecordsPanel({
  athleteId,
  canEdit,
}: {
  athleteId: string;
  /** El coach que lleva al atleta registra; el atleta solo lee las suyas. */
  canEdit: boolean;
}) {
  const unit = useSession((s) => s.unit);
  const records = useRemote<OneRepMaxOut[]>(
    useCallback(() => listRecords(athleteId), [athleteId]),
    [athleteId],
  );
  const [adding, setAdding] = useState(false);

  const list = records.data ?? [];

  function confirmDelete(r: OneRepMaxOut) {
    Alert.alert('Borrar marca', `${r.exerciseName} · ${formatLoad(r.valueKg, unit)}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () =>
          void deleteRecord(athleteId, r.id).then(records.reload, (e) =>
            Alert.alert('Error', errorText(e, 'No se pudo borrar.')),
          ),
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.sectionLabel}>MARCAS (1RM)</Text>
        {canEdit ? (
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Registrar marca"
            hitSlop={8}
          >
            <Ionicons name="add-circle-outline" size={18} color={color.accent} />
          </Pressable>
        ) : null}
      </View>

      {records.loading && records.data === null ? (
        <ActivityIndicator color={color.accent} style={{ marginVertical: space.md }} />
      ) : null}

      {records.data !== null && list.length === 0 ? (
        <Text style={styles.empty}>Sin marcas registradas todavía.</Text>
      ) : null}

      {list.map((r) => (
        <View key={r.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.name}>{r.exerciseName}</Text>
            <Text style={styles.meta}>
              {r.achievedOn} · {SOURCE_LABEL[r.source]}
            </Text>
          </View>
          <Text style={styles.value}>{formatLoad(r.valueKg, unit)}</Text>
          {canEdit ? (
            <Pressable
              onPress={() => confirmDelete(r)}
              accessibilityRole="button"
              accessibilityLabel={`Borrar marca de ${r.exerciseName}`}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={16} color={color.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ))}

      {adding ? (
        <AddRecordSheet
          athleteId={athleteId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            records.reload();
          }}
        />
      ) : null}
    </View>
  );
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError
    ? e.offline
      ? 'Sin conexión con el servidor.'
      : e.message
    : fallback;
}

function AddRecordSheet({
  athleteId,
  onClose,
  onSaved,
}: {
  athleteId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const catalog = useRemote<ExerciseCatalogOut[]>(useCallback(() => listExercises(), []), []);
  // Filtrado a BASICOS por defecto: es donde vive el 1RM real.
  const [onlyBasicos, setOnlyBasicos] = useState(true);
  const items = useMemo(() => {
    const all = catalog.data ?? [];
    return onlyBasicos ? all.filter((e) => e.muscle === 'BASICOS') : all;
  }, [catalog.data, onlyBasicos]);
  const grouped = useMemo(() => groupByMuscle(items), [items]);

  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [kg, setKg] = useState('');
  const [achievedOn, setAchievedOn] = useState(todayIso());
  const [source, setSource] = useState<OneRepMaxSource>('test');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (exerciseId === null || busy) return;
    const value = Number(kg.trim().replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Escribí un peso válido.');
      return;
    }
    if (achievedOn.trim().length === 0) {
      setError('Escribí la fecha del test (AAAA-MM-DD).');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await createRecord(athleteId, {
        exerciseId,
        valueKg: value,
        achievedOn: achievedOn.trim(),
        source,
        note: note.trim().length > 0 ? note.trim() : null,
      });
      onSaved();
    } catch (e) {
      setError(errorText(e, 'No se pudo guardar.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>REGISTRAR MARCA</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
            <Ionicons name="close" size={19} color={color.textMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>EJERCICIO</Text>
            <Pressable onPress={() => setOnlyBasicos((v) => !v)} hitSlop={6}>
              <Text style={styles.toggle}>
                {onlyBasicos ? 'Ver todos' : 'Solo básicos'}
              </Text>
            </Pressable>
          </View>

          {catalog.loading && catalog.data === null ? (
            <ActivityIndicator color={color.accent} style={{ marginVertical: space.sm }} />
          ) : null}

          {grouped.map((g) => (
            <View key={g.muscle} style={styles.group}>
              <Text style={styles.groupTitle}>{g.label.toUpperCase()}</Text>
              <View style={styles.chips}>
                {g.items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setExerciseId(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                    style={[styles.chip, exerciseId === item.id && styles.chipOn]}
                  >
                    <Text
                      style={[styles.chipText, exerciseId === item.id && styles.chipTextOn]}
                    >
                      {item.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          <Text style={styles.fieldLabel}>KILOS</Text>
          <TextInput
            style={styles.input}
            value={kg}
            onChangeText={setKg}
            keyboardType="decimal-pad"
            placeholder="140"
            placeholderTextColor={color.textFaint}
            accessibilityLabel="Kilos de la marca"
          />

          <Text style={styles.fieldLabel}>FECHA DEL TEST (AAAA-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={achievedOn}
            onChangeText={setAchievedOn}
            placeholder={todayIso()}
            placeholderTextColor={color.textFaint}
            autoCapitalize="none"
            accessibilityLabel="Fecha del test"
          />

          <Text style={styles.fieldLabel}>ORIGEN</Text>
          <View style={styles.chips}>
            {(Object.keys(SOURCE_LABEL) as OneRepMaxSource[]).map((s) => (
              <Pressable
                key={s}
                onPress={() => setSource(s)}
                accessibilityRole="button"
                accessibilityLabel={SOURCE_LABEL[s]}
                style={[styles.chip, source === s && styles.chipOn]}
              >
                <Text style={[styles.chipText, source === s && styles.chipTextOn]}>
                  {SOURCE_LABEL[s]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>NOTA (opcional)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Con cinturón, sin monolift..."
            placeholderTextColor={color.textFaint}
            accessibilityLabel="Nota"
          />

          {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.sheetFooter}>
          <Pressable
            onPress={() => void save()}
            disabled={exerciseId === null || busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primary,
              (exerciseId === null || busy) && styles.off,
              pressed && exerciseId !== null && !busy && styles.primaryPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={color.onAccent} />
            ) : (
              <Text style={styles.primaryText}>GUARDAR</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { color: color.textMuted, fontSize: 10, letterSpacing: 2 },
  empty: { color: color.textFaint, fontSize: 12.5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 11,
    borderRadius: radius.card,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  rowText: { flex: 1, gap: 2 },
  name: { color: color.text, fontSize: 13.5, fontWeight: '500' },
  meta: { color: color.textMuted, fontSize: 11 },
  value: {
    color: color.text,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginRight: space.sm,
  },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: color.bgRaised,
    borderTopWidth: 1,
    borderTopColor: color.border,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: space.lg,
    paddingBottom: space.sm,
  },
  sheetTitle: { color: color.text, fontSize: 15, fontWeight: '600', letterSpacing: 2 },
  sheetBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm },
  sheetFooter: {
    flexDirection: 'row',
    padding: space.lg,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },

  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
  },
  fieldLabel: { color: color.textFaint, fontSize: 9.5, letterSpacing: 1.4, marginTop: space.sm },
  toggle: { color: color.accent, fontSize: 11.5 },

  group: { gap: 5, marginTop: 4 },
  groupTitle: { color: color.accent, fontSize: 9.5, letterSpacing: 1.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
  },
  chipOn: { borderColor: color.accent, backgroundColor: color.rowHighlight },
  chipText: { color: color.textMuted, fontSize: 12 },
  chipTextOn: { color: color.text, fontWeight: '600' },

  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: palette.n900,
    color: color.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.chip,
  },
  error: { color: color.accent, fontSize: 12.5, lineHeight: 18, marginTop: space.sm },

  primary: {
    flex: 1,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.chip,
  },
  primaryPressed: { backgroundColor: palette.accentEdge },
  off: { opacity: 0.4 },
  primaryText: { color: color.onAccent, fontSize: 13, fontWeight: '600', letterSpacing: 2.4 },
});
