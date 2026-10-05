/**
 * Qué discos van a cada lado de la barra para una carga total.
 *
 * Solo sirve para pintar: el estado y el motor siguen hablando en kg totales.
 */

// ponytail: barra y juego de discos fijos (20 kg, de 25 a 1.25). Si un gimnasio
// usa otra barra u otros discos, estas dos constantes pasan a ajustes.
export const BAR_KG = 20;
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export type PlateKg = (typeof PLATES_KG)[number];

/**
 * Discos de un lado, del más pesado al más ligero. Lista vacía si es la barra
 * sola. null si la carga no se puede montar exacta: pesa menos que la barra o
 * no cuadra con los discos, y dibujar algo aproximado sería mentir.
 */
export function platesPerSide(totalKg: number): PlateKg[] | null {
  let side = (totalKg - BAR_KG) / 2;
  if (side < 0) return null;

  const out: PlateKg[] = [];
  for (const p of PLATES_KG) {
    while (side >= p - 1e-6) {
      out.push(p);
      side -= p;
    }
  }
  return side > 1e-6 ? null : out;
}
