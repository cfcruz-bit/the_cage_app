/**
 * Tokens del sistema Nocturne, portados de docs/design-tokens.json.
 *
 * Regla: ninguna pantalla escribe un color literal. Si necesitas un tono que no
 * está aquí, se añade aquí primero.
 */

import { Appearance, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Tema. Se decide UNA vez, al arrancar, y no cambia con la app abierta.
 *
 * Todas las pantallas leen estos tokens dentro de `StyleSheet.create`, que se
 * evalúa al importar. Cambiar de tema en caliente obligaría a pasar cada
 * pantalla a un hook; en vez de eso, Ajustes guarda la preferencia y recarga
 * la app. Un cambio que se hace una vez no justifica tocar treinta archivos.
 *
 * Por eso se lee con `SecureStore.getItem`, que es síncrono: hace falta antes
 * del primer render, cuando todavía no hay nada asíncrono resuelto.
 */
export type ThemePref = 'dark' | 'light' | 'system';
export const THEME_KEY = 'cage.theme';

function readThemePref(): ThemePref {
  try {
    const v = SecureStore.getItem(THEME_KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export const themePref = readThemePref();
export const scheme: 'dark' | 'light' =
  themePref === 'system' ? (Appearance.getColorScheme() === 'light' ? 'light' : 'dark') : themePref;

const dark = {
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
  /** Gris tenue: 4.5:1 sobre negro, sobre raised y sobre sunken. */
  n550: '#84817a',
  n600: '#6b6862',
  n700: '#4c4a45',
  n800: '#2e2e2b',
  n900: '#1b1b1a',
  black: '#0a0a0a',
  raised: '#131313',
};

/**
 * El claro invierte la escala de neutros con los mismos nombres: `n200` sigue
 * siendo "el texto" y `n900` "el fondo de un campo", así que cada pantalla
 * queda bien en los dos sin saber cuál está activo.
 *
 * Tres excepciones que NO se invierten porque siempre van sobre rojo o sobre
 * oscuro: `a100` (texto sobre el acento y sobre el corte), `a800` (fondo del
 * chip activo) y `slam`. El acento se oscurece: el de oscuro no llega a 4.5:1
 * sobre hueso.
 */
const light: Record<keyof typeof dark, string> = {
  accent: '#b02a20',
  accentEdge: '#8e1a13',
  slam: '#8e1a13',
  a100: '#f7f4ec',
  a200: '#2e2e2b',
  a300: '#5e1a14',
  a400: '#b02a20',
  a500: '#b02a20',
  a700: '#ecd3cc',
  a800: '#2e2e2b',
  a900: '#ece7db',
  n200: '#191917',
  n300: '#2e2e2b',
  n400: '#4c4a45',
  n500: '#5c5953',
  n550: '#6b6862',
  n600: '#8d8a80',
  n700: '#b9b5a9',
  n800: '#ded6c4',
  n900: '#efebe1',
  black: '#f7f4ec',
  raised: '#ffffff',
};

export const palette: Record<keyof typeof dark, string> = scheme === 'light' ? light : dark;

export const color = {
  bg: palette.black,
  bgRaised: palette.raised,
  bgSunken: palette.a900,
  border: palette.n800,
  borderActive: palette.accent,
  text: palette.n200,
  textMuted: palette.n500,
  textFaint: palette.n550,
  accent: palette.accent,
  accentDim: palette.a700,
  onAccent: palette.a100,
  rowHighlight: scheme === 'light' ? 'rgba(176,42,32,0.07)' : 'rgba(224,74,58,0.08)',
  danger: palette.a300,
  /** Fondo del corte a pantalla completa al entrar en un rol. */
  slam: palette.slam,
  /** Hueso: el botón principal sobre el rojo profundo. Claro en los dos temas. */
  bone: palette.a100,
  onBone: '#0a0a0a',
  /** El check de un set hecho: hueso sobre oscuro, gris casi negro sobre claro. */
  done: scheme === 'light' ? '#2e2e2b' : palette.a100,
  onDone: scheme === 'light' ? '#f7f4ec' : '#0a0a0a',
  /** La nota fija del coach: un papel aparte, cálido, distinto de la explicación del motor. */
  pinBg: scheme === 'light' ? '#f3ead2' : '#221f18',
  pinBorder: scheme === 'light' ? '#e2d5b0' : '#3a352a',
  pinText: scheme === 'light' ? '#2e2e2b' : '#ece7db',
  /** Técnicas de intensidad (RP, DROP, MYO): amarillo de disco, aparte del rojo. */
  tech: scheme === 'light' ? '#8a6a00' : '#e3b322',
} as const;

/** Barra de estado del sistema: texto claro sobre oscuro y al revés. */
export const statusBarStyle = scheme === 'light' ? 'dark' : 'light';

/** Colores reales de los discos, por kilo. Solo para el dibujo de la barra. */
export const plate = {
  25: '#d2362c',
  20: '#2a5fb8',
  15: '#e3b322',
  10: '#2f8f4e',
  5: '#e8e4da',
  2.5: '#d2362c',
  1.25: '#a9aaad',
  steel: '#8f9094',
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

/**
 * Condensada del sistema para las cifras que se leen a un metro: la carga del
 * set activo y la cuenta atrás. Sin fuente propia: cada plataforma trae una.
 */
export const condensed = Platform.select({
  ios: { fontFamily: 'AvenirNextCondensed-Heavy' },
  default: { fontFamily: 'sans-serif-condensed', fontWeight: '700' },
}) as { fontFamily: string; fontWeight?: '700' };

/** Estilo de chip seleccionable, el patrón más repetido del prototipo. */
export function chipStyle(active: boolean) {
  return active
    ? { backgroundColor: palette.a800, borderColor: color.accent, color: palette.a100 }
    : { backgroundColor: 'transparent', borderColor: color.border, color: palette.n400 };
}
