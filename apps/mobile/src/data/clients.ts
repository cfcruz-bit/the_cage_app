/**
 * Clientes del coach.
 *
 * Datos del prototipo, literales. En la Fase 2 los sirve
 * `GET /coach/clients` filtrado por la tabla coach_athletes; hasta entonces
 * viven aquí para que la pantalla sea real y demostrable.
 */

export type SessionStatus = 'Completa' | 'Al límite' | 'Parcial' | 'Perdida';

export interface ClientSession {
  dow: string;
  day: string;
  name: string;
  meta: string;
  status: SessionStatus;
}

export interface Client {
  id: string;
  name: string;
  initials: string;
  meso: string;
  adherence: string;
  /** Progreso del mesociclo, 0–100. */
  bar: number;
  alert: boolean;
  alertText: string;
  sessions: ClientSession[];
}

export const CLIENTS: Client[] = [
  {
    id: 'jm',
    name: 'Jorge Mass',
    initials: 'JM',
    meso: 'Push/Pull/Legs · Sem 5 de 6',
    adherence: '94%',
    bar: 83,
    alert: false,
    alertText:
      'Tres sesiones seguidas con RIR 0 en pecho. Sugerencia: −1 hard set y mantener carga la próxima semana.',
    sessions: [
      { dow: 'Lun', day: '02', name: 'Push A', meta: '18 sets · 6.4 t · RIR medio 1.8', status: 'Completa' },
      { dow: 'Sáb', day: '30', name: 'Legs B', meta: '20 sets · 11.2 t · RIR medio 2.1', status: 'Completa' },
      { dow: 'Jue', day: '28', name: 'Pull A', meta: '16 sets · 5.8 t · RIR medio 0.4', status: 'Al límite' },
      { dow: 'Mar', day: '26', name: 'Push B', meta: 'Sin registro', status: 'Perdida' },
    ],
  },
  {
    id: 'ac',
    name: 'Ana Cortés',
    initials: 'AC',
    meso: 'Upper/Lower · Sem 2 de 5',
    adherence: '88%',
    bar: 40,
    alert: true,
    alertText:
      'Dolor articular moderado en hombro dos semanas seguidas. Sugerencia: sustituir overhead press por press en máquina.',
    sessions: [
      { dow: 'Dom', day: '01', name: 'Upper A', meta: '17 sets · 4.1 t · RIR medio 2.4', status: 'Completa' },
      { dow: 'Vie', day: '29', name: 'Lower A', meta: '15 sets · 7.6 t · RIR medio 2.0', status: 'Completa' },
      { dow: 'Mié', day: '27', name: 'Upper B', meta: '12 de 17 sets', status: 'Parcial' },
      { dow: 'Lun', day: '25', name: 'Lower B', meta: '15 sets · 7.1 t', status: 'Completa' },
    ],
  },
  {
    id: 'ds',
    name: 'Diego Salas',
    initials: 'DS',
    meso: 'Fuerza 5×5 · Sem 4 de 8',
    adherence: '76%',
    bar: 50,
    alert: true,
    alertText:
      'e1RM de sentadilla plano tres semanas. Sugerencia: deload del 12% y volver a subir en saltos de 2.5 kg.',
    sessions: [
      { dow: 'Sáb', day: '30', name: 'Fuerza A', meta: '12 sets · 9.8 t · RIR medio 1.2', status: 'Completa' },
      { dow: 'Jue', day: '28', name: 'Fuerza B', meta: '12 sets · 8.9 t', status: 'Completa' },
      { dow: 'Mar', day: '26', name: 'Fuerza A', meta: 'Sin registro', status: 'Perdida' },
      { dow: 'Dom', day: '24', name: 'Fuerza B', meta: '12 sets · 8.7 t', status: 'Completa' },
    ],
  },
  {
    id: 'lr',
    name: 'Laura Rivas',
    initials: 'LR',
    meso: 'Full body · Sem 1 de 6',
    adherence: '100%',
    bar: 17,
    alert: false,
    alertText: 'Primera semana dentro de rango en todos los ejercicios. Nada que ajustar todavía.',
    sessions: [
      { dow: 'Lun', day: '02', name: 'Full body A', meta: '16 sets · 4.9 t · RIR medio 2.6', status: 'Completa' },
      { dow: 'Vie', day: '29', name: 'Onboarding', meta: 'Test de cargas iniciales', status: 'Completa' },
    ],
  },
  {
    id: 'mp',
    name: 'Marco Peña',
    initials: 'MP',
    meso: 'Push/Pull · Sem 6 de 6 (deload)',
    adherence: '81%',
    bar: 96,
    alert: true,
    alertText:
      'Cierra el meso el domingo. Sugerencia: generar el siguiente con +2 hard sets en espalda.',
    sessions: [
      { dow: 'Dom', day: '01', name: 'Deload Push', meta: '9 sets · 3.2 t', status: 'Completa' },
      { dow: 'Vie', day: '29', name: 'Deload Pull', meta: '9 sets · 3.0 t', status: 'Completa' },
      { dow: 'Mié', day: '27', name: 'Push B', meta: '18 sets · 7.1 t · RIR medio 0.8', status: 'Al límite' },
      { dow: 'Lun', day: '25', name: 'Pull B', meta: '17 sets · 6.5 t', status: 'Completa' },
    ],
  },
];

export const COACH_STATS = [
  { label: 'Adherencia', value: '86%', accent: false },
  { label: 'Sesiones/sem', value: '47', accent: false },
  { label: 'Alertas', value: '3', accent: true },
] as const;

export function findClient(id: string | null): Client {
  return CLIENTS.find((c) => c.id === id) ?? CLIENTS[0]!;
}

/** "Push/Pull/Legs · Sem 5 de 6" → { current: 5, total: 6 } */
export function parseMesoWeeks(meso: string): { current: number; total: number } {
  const current = parseInt(meso.match(/Sem (\d+)/)?.[1] ?? '1', 10);
  const total = parseInt(meso.match(/de (\d+)/)?.[1] ?? '6', 10);
  return { current, total };
}
