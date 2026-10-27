/**
 * El plan semana por semana, editable celda a celda.
 *
 * La tabla llega **pre-rellenada por el motor**: cada celda es lo que la
 * autorregulación propone para ese ejercicio en esa semana. El coach toca lo
 * que quiera; lo que toca manda, y lo que deja en paz lo sigue ajustando el
 * motor con el RIR y el feedback reales del atleta.
 *
 * Esa mezcla es todo el diseño. Una tabla sin motor obliga a escribir seis
 * semanas a mano por ejercicio; un motor sin tabla no deja al coach forzar la
 * semana que sabe que su atleta viene reventado. Aquí se pueden las dos cosas,
 * y las celdas que el coach fijó se marcan para que sepa cuáles son suyas.
 *
 * Una intervención **arrastra**: forzar 80 kg en la semana 3 hace que la 4
 * progrese desde 80. Volver al carril original haría parecer que se ignoró.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { planGrid, setExerciseNote, setPrescription } from '@/api/endpoints';
import type { PlanCellOut, PlanGridOut, PlanRowOut } from '@/api/types';
import { dayHeading, groupByDay } from '@/lib/days';
import { NO_BACKOFF, type ParsedLoad, parseBackoff, parseLoadInput } from '@/lib/loadInput';
import { useRemote } from '@/lib/remote';
import { type Unit, formatNumber } from '@/lib/units';
import { useSession } from '@/stores/session';
import { color, palette, radius, space } from '@/theme/tokens';

/** "75% · 105 kg" | "75% · sin marca" | "105 kg" | "—". */
function loadText(cell: PlanCellOut, unit: Unit): string {
  if (cell.loadPercent !== null) {
    const pct = `${trimPct(cell.loadPercent)}%`;
    if (cell.loadKg !== null) return `${pct} · ${formatNumber(cell.loadKg, unit)} kg`;
    return `${pct} · sin marca`;
  }
  if (cell.loadKg !== null) return formatNumber(cell.loadKg, unit);
  return '—';
}

/** "3×5 · 75% · 105 kg", o null si la semana no lleva back-off. */
function backoffText(cell: PlanCellOut, unit: Unit): string | null {
  if (cell.backoffSets == null) return null;
  const kg = cell.backoffLoadKg === null ? null : `${formatNumber(cell.backoffLoadKg, unit)} kg`;
  const load =
    cell.backoffLoadPercent === null
      ? kg
      : `${trimPct(cell.backoffLoadPercent)}% · ${kg ?? 'sin marca'}`;
  return `${cell.backoffSets}×${cell.backoffReps} · ${load}`;
}

function trimPct(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/**
 * `readOnly` es la vista del atleta: lo mismo que pautó su coach, semana a
 * semana, sin poder tocar ninguna celda.
 */
export function PlanGrid({
  mesocycleId,
  readOnly = false,
}: {
  mesocycleId: string;
  readOnly?: boolean;
}) {
  const remote = useRemote<PlanGridOut>(
    useCallback(() => planGrid(mesocycleId), [mesocycleId]),
    [mesocycleId],
  );
  const [editing, setEditing] = useState<{
    row: PlanRowOut;
    cell: PlanCellOut;
  } | null>(null);
  const [noteFor, setNoteFor] = useState<PlanRowOut | null>(null);

  // Con el selector, no con getState(): leerlo fuera del ciclo de React
  // dejaría la tabla en kilos después de que el atleta cambie a libras.
  const unit = useSession((s) => s.unit);

  if (remote.data === null) {
    return (
      <View style={styles.center}>
        {remote.loading ? (
          <ActivityIndicator color={color.accent} />
        ) : (
          <>
            <Text style={styles.emptyBody}>
              {remote.error ?? 'No se pudo cargar el plan.'}
            </Text>
            <Pressable onPress={remote.reload} accessibilityRole="button">
              <Text style={styles.link}>Reintentar</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const grid = remote.data;

  if (grid.rows.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyBody}>Este bloque no tiene ejercicios.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        {readOnly
          ? 'Lo que pautó tu coach para cada semana. Lo que no fijó a mano lo ajusta el motor con tu feedback.'
          : 'Cada celda es lo que propone el motor. Toca una para pautarla a mano; lo que no toques lo sigue ajustando él con el feedback del atleta.'}
      </Text>

      {groupByDay(grid.rows).map((group) => (
        <View key={group.dayNumber} style={styles.dayGroup}>
          {/* Con un solo día sin nombre el encabezado no dice nada. */}
          {grid.daysPerWeek > 1 || grid.days.length > 0 ? (
            <Text style={styles.dayHeading}>{dayHeading(group.dayNumber, grid.days)}</Text>
          ) : null}

          {group.items.map((row) => (
        <View key={row.mesocycleExerciseId} style={styles.card}>
          <Text style={styles.name}>{row.name}</Text>
          <Text style={styles.meta}>{row.equipment}</Text>

          {/* La nota fija: el atleta la ve encima de sus sets cada semana. */}
          {readOnly ? (
            row.note ? <Text style={styles.note}>{row.note}</Text> : null
          ) : (
            <Pressable
              onPress={() => setNoteFor(row)}
              accessibilityRole="button"
              accessibilityLabel={row.note ? `Editar la nota de ${row.name}` : `Añadir nota a ${row.name}`}
              style={({ pressed }) => [styles.noteRow, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="pin-outline" size={13} color={row.note ? color.text : color.accent} />
              <Text style={row.note ? styles.note : styles.link} numberOfLines={2}>
                {row.note ?? 'Añadir nota para el atleta'}
              </Text>
            </Pressable>
          )}

          {/* La tabla desborda a lo ancho en cuanto hay 6 semanas: se desplaza
              sola en vez de apretar las columnas hasta que no se lean. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.head}>
                <Text style={[styles.cell, styles.cellWeek, styles.headText]}>Sem</Text>
                <Text style={[styles.cell, styles.headText]}>Sets</Text>
                <Text style={[styles.cell, styles.cellWide, styles.headText]}>Reps</Text>
                <Text style={[styles.cell, styles.cellWide, styles.headText]}>Carga</Text>
                <Text style={[styles.cell, styles.headText]}>RIR</Text>
              </View>

              {row.weeks.map((cell) => {
                // Un básico exige carga en cada semana; si falta, es un hueco
                // que hay que llenar, no un "automático" normal.
                const missing = row.muscle === 'BASICOS' && cell.loadKg === null;
                const backoff = backoffText(cell, unit);
                return (
                  <Pressable
                    key={cell.weekNumber}
                    onPress={readOnly ? undefined : () => setEditing({ row, cell })}
                    disabled={readOnly}
                    accessibilityRole={readOnly ? undefined : 'button'}
                    accessibilityLabel={
                      readOnly
                        ? `${row.name}, semana ${cell.weekNumber}`
                        : `Pautar ${row.name}, semana ${cell.weekNumber}`
                    }
                    style={({ pressed }) => [
                      styles.week,
                      cell.isDeload && styles.rowDeload,
                      cell.weekNumber === grid.currentWeekIndex + 1 && styles.rowNow,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <View style={styles.row}>
                      <Text style={[styles.cell, styles.cellWeek]}>
                        {cell.isDeload ? 'DL' : `s${cell.weekNumber}`}
                      </Text>
                      <Value text={String(cell.sets)} pinned={cell.setsOverridden} />
                      <Value
                        wide
                        text={
                          cell.repLo === cell.repHi ? `${cell.repLo}` : `${cell.repLo}–${cell.repHi}`
                        }
                        pinned={cell.repsOverridden}
                      />
                      <Value
                        wide
                        text={loadText(cell, unit)}
                        pinned={cell.loadOverridden}
                        warn={cell.needsOneRm}
                        error={missing}
                      />
                      <Value text={String(cell.targetRir)} pinned={cell.rirOverridden} />
                    </View>
                    {backoff !== null ? (
                      <Text
                        style={[styles.backoffLine, cell.backoffNeedsOneRm && styles.valueWarn]}
                      >
                        BACK-OFF {backoff}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
          ))}
        </View>
      ))}

      {noteFor !== null ? (
        <NoteSheet
          mesocycleId={mesocycleId}
          row={noteFor}
          onClose={() => setNoteFor(null)}
          onSaved={() => {
            setNoteFor(null);
            remote.reload();
          }}
        />
      ) : null}

      {editing !== null ? (
        <CellSheet
          mesocycleId={mesocycleId}
          row={editing.row}
          cell={editing.cell}
          unit={unit}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            remote.reload();
          }}
        />
      ) : null}
    </View>
  );
}

/** Un número de la tabla. Los que puso el coach se distinguen del resto. */
function Value({
  text,
  pinned,
  wide = false,
  warn = false,
  error = false,
}: {
  text: string;
  pinned: boolean;
  wide?: boolean;
  /** % sin marca: se puede resolver en cuanto exista una. */
  warn?: boolean;
  /** Básico sin carga: es obligatoria y falta. */
  error?: boolean;
}) {
  return (
    <View
      style={[
        styles.cell,
        wide && styles.cellWide,
        styles.valueBox,
        error && styles.valueBoxError,
      ]}
    >
      <Text
        style={[
          styles.value,
          pinned && styles.valuePinned,
          warn && styles.valueWarn,
          error && styles.valueError,
        ]}
      >
        {text}
      </Text>
      {pinned ? <View style={styles.pin} /> : null}
    </View>
  );
}

/* ── Nota del coach ───────────────────────────────────────────────────────── */

/** Una sola nota por ejercicio, para todo el bloque. Vaciarla la borra. */
function NoteSheet({
  mesocycleId,
  row,
  onClose,
  onSaved,
}: {
  mesocycleId: string;
  row: PlanRowOut;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(row.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setExerciseNote(mesocycleId, row.mesocycleExerciseId, text);
      onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.offline
            ? 'Sin conexión con el servidor.'
            : e.message
          : 'No se pudo guardar.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.lift} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />

        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{row.name.toUpperCase()}</Text>
              <Text style={styles.meta}>Nota para todo el bloque</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
              <Ionicons name="close" size={19} color={color.textMuted} />
            </Pressable>
          </View>

          <View style={styles.sheetBody}>
            <Text style={styles.hint}>
              El atleta la ve encima de sus sets cada semana. Úsala para técnica o
              ejecución: "pausa de 1 s abajo", "drop set en la última".
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              maxLength={280}
              autoFocus
              placeholder="Escribe la indicación"
              placeholderTextColor={color.textFaint}
              accessibilityLabel={`Nota de ${row.name}`}
              style={[styles.fieldInput, styles.noteInput]}
            />
            <Text style={styles.hintFaint}>{text.length}/280</Text>
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.sheetFooter}>
            <Pressable
              onPress={() => setText('')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.secondaryText}>Borrar nota</Text>
            </Pressable>

            <Pressable
              onPress={() => void save()}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                busy && { opacity: 0.4 },
                pressed && !busy && { backgroundColor: palette.accentEdge },
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── Editar una celda ─────────────────────────────────────────────────────── */

/** El texto que ve el coach al abrir la celda: "75%", "105", o vacío. */
function loadFieldSeed(cell: PlanCellOut): string {
  if (!cell.loadOverridden) return '';
  if (cell.loadPercent !== null) return `${trimPct(cell.loadPercent)}%`;
  if (cell.loadKg !== null) return String(cell.loadKg);
  return '';
}

function CellSheet({
  mesocycleId,
  row,
  cell,
  unit,
  onClose,
  onSaved,
}: {
  mesocycleId: string;
  row: PlanRowOut;
  cell: PlanCellOut;
  unit: Unit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sets, setSets] = useState(cell.setsOverridden ? String(cell.sets) : '');
  const [load, setLoad] = useState(loadFieldSeed(cell));
  const [repLo, setRepLo] = useState(cell.repsOverridden ? String(cell.repLo) : '');
  const [repHi, setRepHi] = useState(cell.repsOverridden ? String(cell.repHi) : '');
  const [rir, setRir] = useState(cell.rirOverridden ? String(cell.targetRir) : '');
  const [rest, setRest] = useState(String(cell.restSeconds));
  const isBasico = row.muscle === 'BASICOS';
  const [bSets, setBSets] = useState(cell.backoffSets == null ? '' : String(cell.backoffSets));
  const [bReps, setBReps] = useState(cell.backoffReps == null ? '' : String(cell.backoffReps));
  const [bLoad, setBLoad] = useState(
    cell.backoffLoadPercent != null
      ? `${trimPct(cell.backoffLoadPercent)}%`
      : cell.backoffLoadKg != null
        ? String(cell.backoffLoadKg)
        : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;

    const lo = numberOrNull(repLo);
    const hi = numberOrNull(repHi);
    if ((lo === null) !== (hi === null)) {
      setError('El rango de reps va entero o vacío.');
      return;
    }
    if (lo !== null && hi !== null && hi < lo) {
      setError('El tope no puede ser menor que el suelo.');
      return;
    }

    const parsed: ParsedLoad = parseLoadInput(load, unit);
    if (parsed.kind === 'invalid') {
      setError(parsed.reason);
      return;
    }

    const backoff = isBasico ? parseBackoff(bSets, bReps, bLoad, unit) : NO_BACKOFF;
    if ('error' in backoff) {
      setError(backoff.error);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await setPrescription(mesocycleId, row.mesocycleExerciseId, {
        ...backoff,
        weekNumber: cell.weekNumber,
        sets: numberOrNull(sets),
        loadKg: parsed.kind === 'kg' ? parsed.value : null,
        loadPercent: parsed.kind === 'percent' ? parsed.value : null,
        repLo: lo,
        repHi: hi,
        targetRir: numberOrNull(rir),
        restSeconds: numberOrNull(rest) ?? cell.restSeconds,
      });
      onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.offline
            ? 'Sin conexión con el servidor.'
            : e.message
          : 'No se pudo guardar.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Sube con el teclado: sin esto, en Android tapa el campo que se escribe. */}
      <KeyboardAvoidingView style={styles.lift} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />

        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{row.name.toUpperCase()}</Text>
              <Text style={styles.meta}>
                {cell.isDeload ? 'Semana de deload' : `Semana ${cell.weekNumber}`}
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
              <Ionicons name="close" size={19} color={color.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.hint}>
              Lo que dejes vacío lo decide el motor. Es como devuelves una celda a
              automático sin borrar el resto.
            </Text>

            <View style={styles.fields}>
              <Field label="Sets" value={sets} onChange={setSets} auto={String(cell.sets)} />
              <Field
                label="CARGA (% o KG)"
                value={load}
                onChange={setLoad}
                auto={cell.loadKg === null ? '—' : String(cell.loadKg)}
              />
              <Field label="RIR" value={rir} onChange={setRir} auto={String(cell.targetRir)} />
            </View>

            <View style={styles.fields}>
              <Field label="Reps mín." value={repLo} onChange={setRepLo} auto={String(cell.repLo)} />
              <Field label="Reps máx." value={repHi} onChange={setRepHi} auto={String(cell.repHi)} />
              <Field label="Descanso (s)" value={rest} onChange={setRest} auto="" />
            </View>

            <Text style={styles.hintFaint}>
              El descanso siempre lo pautas tú: no tiene modo automático.
            </Text>

            {isBasico ? (
              <>
                <Text style={styles.fieldLabel}>Back-off (opcional)</Text>
                <Text style={styles.hintFaint}>
                  Con back-off, sets, reps y carga de arriba son el TOP set. La carga del
                  back-off es fija: no depende de lo que salga el top.
                </Text>
                <View style={styles.fields}>
                  <Field label="Sets" value={bSets} onChange={setBSets} auto="—" />
                  <Field label="Reps" value={bReps} onChange={setBReps} auto="—" />
                  <Field label="CARGA (% o KG)" value={bLoad} onChange={setBLoad} auto="—" />
                </View>
              </>
            ) : null}

            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.sheetFooter}>
            <Pressable
              onPress={() => {
                setSets('');
                setLoad('');
                setRepLo('');
                setRepHi('');
                setRir('');
                setBSets('');
                setBReps('');
                setBLoad('');
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.secondaryText}>Todo automático</Text>
            </Pressable>

            <Pressable
              onPress={() => void save()}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                busy && { opacity: 0.4 },
                pressed && !busy && { backgroundColor: palette.accentEdge },
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Campo de la hoja de edición.
 *
 * Vacío significa "automático", y el marcador de posición enseña lo que el
 * motor propone. Así el coach ve el número sin tener que aceptarlo.
 */
function Field({
  label,
  value,
  onChange,
  auto,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  auto: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, value.length > 0 && styles.fieldInputPinned]}
        value={value}
        onChangeText={onChange}
        placeholder={auto}
        placeholderTextColor={color.textFaint}
        keyboardType="numeric"
        selectTextOnFocus
        accessibilityLabel={label}
      />
    </View>
  );
}

function numberOrNull(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  dayGroup: { gap: space.sm, marginTop: space.sm },
  dayHeading: { color: color.accent, fontSize: 12, letterSpacing: 0.2 },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xxl },
  emptyBody: { color: color.textMuted, fontSize: 12.5, textAlign: 'center' },
  link: { color: color.accent, fontSize: 13 },
  hint: { color: color.textFaint, fontSize: 12, lineHeight: 17 },
  hintFaint: { color: color.textFaint, fontSize: 12, lineHeight: 16 },
  error: { color: color.accent, fontSize: 12.5, lineHeight: 18 },

  card: {
    padding: 13,
    borderRadius: radius.card,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  name: { color: color.text, fontSize: 14.5, fontWeight: '600' },
  meta: { color: color.textMuted, fontSize: 12, marginTop: 1 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: space.sm },
  note: { flex: 1, color: color.text, fontSize: 12.5, lineHeight: 17 },
  noteInput: { minHeight: 88, textAlignVertical: 'top', textAlign: 'left' },

  head: {
    flexDirection: 'row',
    marginTop: space.md,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  headText: { color: color.textFaint, fontSize: 12, letterSpacing: 0.2 },
  week: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  backoffLine: {
    paddingLeft: 44,
    paddingTop: 3,
    color: color.textMuted,
    fontSize: 12,
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
  rowNow: { backgroundColor: color.rowHighlight },
  rowDeload: { opacity: 0.6 },

  cell: { width: 62, textAlign: 'center', color: color.textMuted, fontSize: 12.5 },
  cellWeek: { width: 44 },
  cellWide: { width: 78 },

  valueBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  valueBoxError: { borderWidth: 1, borderColor: color.accent, borderRadius: radius.chip },
  value: { color: color.textMuted, fontSize: 12.5, fontVariant: ['tabular-nums'] },
  valuePinned: { color: color.text, fontWeight: '600' },
  /** % sin marca todavía: se puede resolver en cuanto exista una. */
  valueWarn: { color: color.danger },
  /** Básico sin carga: es obligatoria y falta. */
  valueError: { color: color.accent, fontWeight: '600' },
  /** Marca de "esto lo puse yo". Un punto, no un color: el color ya lo usa la
   *  semana en curso y dos significados en el mismo canal se confunden. */
  pin: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.accent },

  lift: { flex: 1 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: color.bgRaised,
    borderTopWidth: 1,
    borderTopColor: color.border,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: space.lg,
    paddingBottom: space.sm,
  },
  sheetTitle: { color: color.text, fontSize: 15, fontWeight: '600', letterSpacing: 2 },
  sheetBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  sheetFooter: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.lg,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },

  fields: { flexDirection: 'row', gap: space.sm },
  field: { flex: 1, gap: 4 },
  fieldLabel: { color: color.textFaint, fontSize: 12, letterSpacing: 0.2 },
  fieldInput: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: palette.n900,
    color: color.text,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radius.chip,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  fieldInputPinned: { borderColor: color.accent },

  primary: {
    flex: 2,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.chip,
  },
  primaryText: { color: color.onAccent, fontSize: 13, fontWeight: '600', letterSpacing: 2.4 },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.chip,
  },
  secondaryText: { color: color.textMuted, fontSize: 12.5, fontWeight: '500' },
});
