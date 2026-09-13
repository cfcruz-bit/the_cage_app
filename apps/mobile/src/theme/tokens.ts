/**
 * Tokens del sistema Nocturne, portados de docs/design-tokens.json.
 *
 * Regla: ninguna pantalla escribe un color literal. Si necesitas un tono que no
 * está aquí, se añade aquí primero.
 */

export const palette = {
  accent: '#e04a3a',
  accentEdge: '#c2231b',
  /** Rojo profundo del corte de entrada. Más oscuro que el acento a propósito:
   *  ocupa la pantalla entera y el acento a ese tamaño deslumbra. */
  slam: '#8e1a13',
  a100: '#f7f4ec',
  a200: '#ece7db',
  a300: '#ded6c4',
  a400: '#b8b1a0',
  a500: '#b02a20',
  a700: '#5e1a14',
  a800: '#2e2e2b',
  a900: '#191917',
  n200: '#edeae1',
  n300: '#dcd8cd',
  n400: '#b9b5a9',
  n500: '#8d8a80',
  n600: '#6b6862',
  n700: '#4c4a45',
  n800: '#2e2e2b',
  n900: '#1b1b1a',
  black: '#0a0a0a',
  raised: '#131313',
} as const;

export const color = {
  bg: palette.black,
  bgRaised: palette.raised,
  bgSunken: palette.a900,
  border: palette.n800,
  borderActive: palette.accent,
  text: palette.n200,
  textMuted: palette.n500,
  textFaint: palette.n600,
  accent: palette.accent,
  accentDim: palette.a700,
  onAccent: palette.a100,
  rowHighlight: 'rgba(224,74,58,0.08)',
  danger: palette.a300,
  /** Fondo del corte a pantalla completa al entrar en un rol. */
  slam: palette.slam,
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { chip: 4, card: 10, sheet: 20 } as const;

export const type = {
  display: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: '600', letterSpacing: -0.2 },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  meta: { fontSize: 13, fontWeight: '400' },
  label: { fontSize: 10.5, fontWeight: '500', letterSpacing: 2.9, textTransform: 'uppercase' },
  numeric: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
} as const;

/** Estilo de chip seleccionable, el patrón más repetido del prototipo. */
export function chipStyle(active: boolean) {
  return active
    ? { backgroundColor: palette.a800, borderColor: color.accent, color: palette.a100 }
    : { backgroundColor: 'transparent', borderColor: color.border, color: palette.n400 };
}
