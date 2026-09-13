/**
 * Modo Coach: lista de clientes y detalle.
 *
 * Como en el prototipo, las dos vistas viven en la misma ruta y se conmutan
 * con estado local — el detalle es una profundización, no un destino con URL
 * propia. En la Fase 2 los datos vienen de `GET /coach/clients`, filtrados por
 * la tabla coach_athletes, y la comprobación de propiedad se hace en cada
 * petición con `{id}`: es el punto donde un IDOR expondría el historial de
 * todos los clientes del gimnasio.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import {
  CLIENTS,
  COACH_STATS,
  SessionStatus,
  findClient,
  parseMesoWeeks,
} from '@/data/clients';
import { color, palette, radius, space } from '@/theme/tokens';

export default function ClientsScreen() {
  const [openId, setOpenId] = useState<string | null>(null);

  return openId ? (
    <ClientDetail id={openId} onBack={() => setOpenId(null)} />
  ) : (
    <ClientList onOpen={setOpenId} />
  );
}

/* ── Lista ────────────────────────────────────────────────────────────────── */

function ClientList({ onOpen }: { onOpen: (id: string) => void }) {
  const alerts = CLIENTS.filter((c) => c.alert).length;

  return (
    <Screen
      title="CLIENTES"
      subtitle={`${CLIENTS.length} activos · ${alerts} requieren revisión`}
    >
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.stats}>
          {COACH_STATS.map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text style={styles.statLabel}>{s.label.toUpperCase()}</Text>
              <Text style={[styles.statValue, s.accent && styles.statValueAccent]}>
                {s.value}
              </Text>
            </View>
          ))}
        </View>

        {CLIENTS.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => onOpen(c.id)}
            accessibilityRole="button"
            accessibilityLabel={`Abrir ${c.name}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{c.initials}</Text>
            </View>

            <View style={styles.rowText}>
              <View style={styles.rowTitle}>
                <Text style={styles.name}>{c.name}</Text>
                {c.alert ? (
                  <Ionicons name="alert-circle" size={13} color={palette.a400} />
                ) : null}
              </View>
              <Text style={styles.meso}>{c.meso}</Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${c.bar}%`, backgroundColor: c.alert ? palette.a400 : palette.a700 },
                  ]}
                />
              </View>
            </View>

            <View style={styles.adherence}>
              <Text style={styles.adherenceValue}>{c.adherence}</Text>
              <Text style={styles.adherenceLabel}>ADHER.</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

/* ── Detalle ──────────────────────────────────────────────────────────────── */

function ClientDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const client = useMemo(() => findClient(id), [id]);
  const { current, total } = useMemo(() => parseMesoWeeks(client.meso), [client.meso]);

  return (
    <Screen
      title={client.name.toUpperCase()}
      subtitle={client.meso}
      leading={
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Volver a clientes"
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={19} color={color.textMuted} />
        </Pressable>
      }
    >
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.alert}>
          <View style={styles.alertHead}>
            <Ionicons name="alert-circle" size={12} color={palette.a300} />
            <Text style={styles.alertLabel}>REQUIERE TU REVISIÓN</Text>
          </View>
          <Text style={styles.alertText}>{client.alertText}</Text>
          <View style={styles.alertActions}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>Aplicar sugerencia</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Editar meso</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.weeks}>
            {Array.from({ length: total }, (_, i) => {
              const n = i + 1;
              const isNow = n === current;
              const past = n < current;
              const state = n === total ? 'deload' : isNow ? 'ahora' : past ? 'hecha' : '—';
              return (
                <View
                  key={n}
                  style={[
                    styles.week,
                    isNow && { backgroundColor: palette.a900, borderColor: color.accent },
                  ]}
                >
                  <Text style={styles.weekLabel}>SEM</Text>
                  <Text
                    style={[
                      styles.weekN,
                      { color: isNow ? palette.a200 : past ? palette.n400 : palette.n700 },
                    ]}
                  >
                    {n}
                  </Text>
                  <Text style={styles.weekState}>{state}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <Text style={styles.sectionLabel}>ÚLTIMAS SESIONES</Text>

        {client.sessions.map((s, i) => {
          const pill = pillFor(s.status);
          return (
            <View key={`${s.day}-${i}`} style={styles.session}>
              <View style={styles.sessionDate}>
                <Text style={styles.sessionDow}>{s.dow.toUpperCase()}</Text>
                <Text style={styles.sessionDay}>{s.day}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.sessionText}>
                <Text style={styles.sessionName}>{s.name}</Text>
                <Text style={styles.sessionMeta}>{s.meta}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                <Text style={[styles.pillText, { color: pill.fg }]}>{s.status}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

function pillFor(status: SessionStatus): { bg: string; fg: string } {
  switch (status) {
    case 'Perdida':
      return { bg: palette.n900, fg: palette.n500 };
    case 'Al límite':
      return { bg: palette.a800, fg: palette.a100 };
    case 'Parcial':
      return { bg: palette.n800, fg: palette.n300 };
    default:
      return { bg: 'transparent', fg: palette.n500 };
  }
}

const styles = StyleSheet.create({
  list: { padding: space.lg, paddingTop: 0, gap: space.sm, paddingBottom: space.xxl },
  pressed: { opacity: 0.65 },

  stats: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  stat: {
    flex: 1,
    padding: space.md,
    borderRadius: radius.chip,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  statLabel: { color: color.textMuted, fontSize: 9.5, letterSpacing: 1.7 },
  statValue: {
    color: color.text,
    fontSize: 23,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  statValueAccent: { color: palette.a300 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 11,
    borderRadius: radius.chip,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 2,
    backgroundColor: palette.a800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: palette.a100, fontSize: 14, fontWeight: '600' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: color.text, fontSize: 14, fontWeight: '500' },
  meso: { color: color.textMuted, fontSize: 11.5 },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.n800,
    marginTop: 7,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 2 },
  adherence: { alignItems: 'flex-end' },
  adherenceValue: { color: color.text, fontSize: 15, fontWeight: '600' },
  adherenceLabel: { color: color.textFaint, fontSize: 9.5, letterSpacing: 1.5 },

  back: { padding: 4 },

  alert: {
    padding: 13,
    borderRadius: radius.card,
    backgroundColor: palette.a900,
    borderWidth: 1,
    borderColor: color.border,
    gap: 6,
  },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  alertLabel: { color: palette.a300, fontSize: 10, letterSpacing: 2 },
  alertText: { color: palette.n200, fontSize: 13, lineHeight: 19 },
  alertActions: { flexDirection: 'row', gap: space.sm, marginTop: 5 },
  primary: {
    flex: 1,
    height: 36,
    borderRadius: radius.chip,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: color.onAccent, fontSize: 12.5, fontWeight: '600' },
  secondary: {
    flex: 1,
    height: 36,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: color.textMuted, fontSize: 12.5, fontWeight: '500' },

  weeks: { flexDirection: 'row', gap: 6, paddingVertical: space.sm },
  week: {
    width: 44,
    paddingVertical: 7,
    borderRadius: radius.chip,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
  },
  weekLabel: { color: color.textMuted, fontSize: 9, letterSpacing: 1.4 },
  weekN: { fontSize: 15, fontWeight: '600' },
  weekState: { color: color.textFaint, fontSize: 9, marginTop: 1 },

  sectionLabel: {
    color: color.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    marginTop: space.sm,
    marginBottom: 2,
  },

  session: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 11,
    borderRadius: radius.card,
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  sessionDate: { width: 34, alignItems: 'center' },
  sessionDow: { color: color.textFaint, fontSize: 9.5, letterSpacing: 1.5 },
  sessionDay: { color: color.text, fontSize: 15, fontWeight: '600' },
  divider: { width: 1, height: 30, backgroundColor: palette.n800 },
  sessionText: { flex: 1, gap: 2 },
  sessionName: { color: color.text, fontSize: 13, fontWeight: '500' },
  sessionMeta: { color: color.textMuted, fontSize: 11 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 2 },
  pillText: { fontSize: 11 },
});
