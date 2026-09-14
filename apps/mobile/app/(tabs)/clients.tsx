/**
 * Modo Coach: lista de clientes y detalle.
 *
 * Como en el prototipo, las dos vistas viven en la misma ruta y se conmutan con
 * estado local: el detalle es una profundización, no un destino con URL propia.
 *
 * Desde la Fase 3 los datos son REALES. Antes venían de `src/data/clients.ts`,
 * que eran los cinco clientes del prototipo con sus alertas escritas a mano;
 * ahora salen de `/coach/athletes/summaries` y `/coach/athletes/{id}/summary`.
 *
 * La comprobación de propiedad NO se hace aquí. Vive en el servidor
 * (`app/api/deps.py`), que responde 404 si el atleta no está en la cartera de
 * este coach. Esconder el botón en la app no es seguridad: es cortesía.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { athleteCards, athleteSummary, coachOverview } from '@/api/endpoints';
import type {
  AlertOut,
  AthleteCardOut,
  AthleteSummaryOut,
  SessionStatus,
} from '@/api/types';
import { Screen } from '@/components/Screen';
import { useRemote } from '@/lib/remote';
import { color, palette, radius, space } from '@/theme/tokens';

export default function ClientsScreen() {
  const [openId, setOpenId] = useState<string | null>(null);

  return openId ? (
    <ClientDetail id={openId} onBack={() => setOpenId(null)} />
  ) : (
    <ClientList onOpen={setOpenId} />
  );
}

/** Iniciales a partir del nombre. El servidor no las manda: son presentación. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "Push/Pull/Legs · Sem 5 de 6" — la misma línea que pintaba el prototipo. */
function mesoLine(
  name: string | null,
  week: number | null,
  total: number | null,
): string {
  if (name === null) return 'Sin mesociclo activo';
  if (week === null || total === null) return name;
  return `${name} · Sem ${week} de ${total}`;
}

/* ── Lista ────────────────────────────────────────────────────────────────── */

function ClientList({ onOpen }: { onOpen: (id: string) => void }) {
  const cards = useRemote<AthleteCardOut[]>(useCallback(() => athleteCards(), []), []);
  const overview = useRemote(useCallback(() => coachOverview(), []), []);

  const reload = useCallback(() => {
    cards.reload();
    overview.reload();
  }, [cards, overview]);

  if (cards.loading && cards.data === null) {
    return (
      <Screen title="CLIENTES">
        <Loading />
      </Screen>
    );
  }

  if (cards.data === null) {
    return (
      <Screen title="CLIENTES">
        <Failure message={cards.error} offline={cards.offline} onRetry={reload} />
      </Screen>
    );
  }

  const list = cards.data;
  const needReview = list.filter((c) => c.alertCount > 0).length;

  const stats = [
    {
      label: 'ADHERENCIA',
      value: overview.data === null ? '—' : adherenceOf(list),
      accent: false,
    },
    {
      label: 'SESIONES/SEM',
      value: overview.data === null ? '—' : String(overview.data.sessionsLast7Days),
      accent: false,
    },
    {
      label: 'ALERTAS',
      value: overview.data === null ? '—' : String(overview.data.openAlerts),
      accent: (overview.data?.openAlerts ?? 0) > 0,
    },
  ];

  return (
    <Screen
      title="CLIENTES"
      subtitle={`${list.length} activos · ${needReview} requieren revisión`}
    >
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={cards.loading}
            onRefresh={reload}
            tintColor={color.accent}
          />
        }
      >
        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text style={[styles.statValue, s.accent && styles.statValueAccent]}>
                {s.value}
              </Text>
            </View>
          ))}
        </View>

        {list.length === 0 ? (
          <Empty
            title="Todavía no llevas a nadie"
            body="Añade atletas por su email desde la pantalla de ajustes. Tienen que tener cuenta creada."
          />
        ) : null}

        {list.map((c) => {
          const alert = c.alertCount > 0;
          return (
            <Pressable
              key={c.athlete.id}
              onPress={() => onOpen(c.athlete.id)}
              accessibilityRole="button"
              accessibilityLabel={`Abrir ${c.athlete.displayName}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {initialsOf(c.athlete.displayName)}
                </Text>
              </View>

              <View style={styles.rowText}>
                <View style={styles.rowTitle}>
                  <Text style={styles.name}>{c.athlete.displayName}</Text>
                  {alert ? (
                    <Ionicons name="alert-circle" size={13} color={palette.a400} />
                  ) : null}
                </View>
                <Text style={styles.meso}>
                  {mesoLine(c.mesocycleName, c.currentWeek, c.totalWeeks)}
                </Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${c.progress}%`,
                        backgroundColor: alert ? palette.a400 : palette.a700,
                      },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.adherence}>
                <Text style={styles.adherenceValue}>
                  {c.adherence === null ? '—' : `${c.adherence}%`}
                </Text>
                <Text style={styles.adherenceLabel}>ADHER.</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

/** Media de adherencia de los atletas que ya tienen sesiones. */
function adherenceOf(cards: AthleteCardOut[]): string {
  const values = cards
    .map((c) => c.adherence)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return '—';
  return `${Math.round(values.reduce((a, b) => a + b, 0) / values.length)}%`;
}

/* ── Detalle ──────────────────────────────────────────────────────────────── */

function ClientDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const remote = useRemote<AthleteSummaryOut>(
    useCallback(() => athleteSummary(id), [id]),
    [id],
  );

  const back = (
    <Pressable
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel="Volver a clientes"
      hitSlop={10}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Ionicons name="arrow-back" size={19} color={color.textMuted} />
    </Pressable>
  );

  if (remote.data === null) {
    return (
      <Screen title="CLIENTE" leading={back}>
        {remote.loading ? (
          <Loading />
        ) : (
          <Failure
            message={remote.error}
            offline={remote.offline}
            onRetry={remote.reload}
          />
        )}
      </Screen>
    );
  }

  const c = remote.data;
  const total = c.totalWeeks ?? 0;
  const current = c.currentWeek ?? 0;

  return (
    <Screen
      title={c.athlete.displayName.toUpperCase()}
      subtitle={mesoLine(c.mesocycleName, c.currentWeek, c.totalWeeks)}
      leading={back}
    >
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={remote.loading}
            onRefresh={remote.reload}
            tintColor={color.accent}
          />
        }
      >
        {c.alerts.length === 0 ? (
          <View style={styles.alert}>
            <View style={styles.alertHead}>
              <Ionicons name="checkmark-circle" size={12} color={palette.n400} />
              <Text style={[styles.alertLabel, { color: palette.n400 }]}>
                NADA QUE REVISAR
              </Text>
            </View>
            <Text style={styles.alertText}>
              Ningún patrón que requiera tu atención esta semana.
            </Text>
          </View>
        ) : (
          c.alerts.map((a, i) => <AlertCard key={`${a.kind}-${i}`} alert={a} />)
        )}

        {total > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.weeks}>
              {Array.from({ length: total }, (_, i) => {
                const n = i + 1;
                const isNow = n === current;
                const past = n < current;
                const state =
                  n === total ? 'deload' : isNow ? 'ahora' : past ? 'hecha' : '—';
                return (
                  <View
                    key={n}
                    style={[
                      styles.week,
                      isNow && {
                        backgroundColor: palette.a900,
                        borderColor: color.accent,
                      },
                    ]}
                  >
                    <Text style={styles.weekLabel}>SEM</Text>
                    <Text
                      style={[
                        styles.weekN,
                        {
                          color: isNow
                            ? palette.a200
                            : past
                              ? palette.n400
                              : palette.n700,
                        },
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
        ) : null}

        <Text style={styles.sectionLabel}>ÚLTIMAS SESIONES</Text>

        {c.sessions.length === 0 ? (
          <Empty
            title="Sin sesiones todavía"
            body="Genera la primera desde el plan del mesociclo."
          />
        ) : null}

        {c.sessions.map((s) => {
          const pill = pillFor(s.status);
          const when = s.completedAt === null ? null : new Date(s.completedAt);
          return (
            <View key={s.id} style={styles.session}>
              <View style={styles.sessionDate}>
                <Text style={styles.sessionDow}>
                  {when === null ? '—' : DOW[when.getDay()]}
                </Text>
                <Text style={styles.sessionDay}>
                  {when === null
                    ? '··'
                    : String(when.getDate()).padStart(2, '0')}
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.sessionText}>
                <Text style={styles.sessionName}>{s.dayLabel}</Text>
                <Text style={styles.sessionMeta}>{metaOf(s.setsDone, s.tonnageKg)}</Text>
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

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

/** "18 sets · 6.4 t", el mismo formato del prototipo. */
function metaOf(sets: number, tonnageKg: number): string {
  if (sets === 0) return 'Sin registro';
  const tons = (tonnageKg / 1000).toFixed(1);
  return `${sets} sets · ${tons} t`;
}

function AlertCard({ alert }: { alert: AlertOut }) {
  const warning = alert.severity === 'warning';
  return (
    <View style={styles.alert}>
      <View style={styles.alertHead}>
        <Ionicons
          name={warning ? 'alert-circle' : 'information-circle'}
          size={12}
          color={warning ? palette.a300 : palette.n400}
        />
        <Text
          style={[styles.alertLabel, !warning && { color: palette.n400 }]}
        >
          {warning ? 'REQUIERE TU REVISIÓN' : 'PARA TU INFORMACIÓN'}
        </Text>
      </View>
      <Text style={styles.alertText}>{alert.text}</Text>
      <Text style={styles.alertSuggestion}>{alert.suggestion}</Text>
    </View>
  );
}

/* ── Estados vacíos y de error ────────────────────────────────────────────── */

function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={color.accent} />
    </View>
  );
}

function Failure({
  message,
  offline,
  onRetry,
}: {
  message: string | null;
  offline: boolean;
  onRetry: () => void;
}) {
  return (
    <View style={styles.center}>
      <Ionicons
        name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
        size={28}
        color={color.textFaint}
      />
      <Text style={styles.emptyTitle}>
        {offline ? 'Sin conexión' : 'No se pudo cargar'}
      </Text>
      <Text style={styles.emptyBody}>
        {offline
          ? 'Comprueba que el servidor está levantado y que el teléfono está en la misma red.'
          : (message ?? 'Inténtalo de nuevo.')}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryText}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function pillFor(status: SessionStatus): { bg: string; fg: string } {
  switch (status) {
    case 'Perdida':
      return { bg: palette.n900, fg: palette.n500 };
    case 'Parcial':
      return { bg: palette.n800, fg: palette.n300 };
    case 'Completa':
      return { bg: palette.a800, fg: palette.a100 };
    default:
      return { bg: 'transparent', fg: palette.n500 };
  }
}

const styles = StyleSheet.create({
  list: { padding: space.lg, paddingTop: 0, gap: space.sm, paddingBottom: space.xxl },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xxl },
  emptyTitle: { color: color.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyBody: { color: color.textMuted, fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
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
  alertSuggestion: { color: color.textMuted, fontSize: 12.5, lineHeight: 18 },
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
