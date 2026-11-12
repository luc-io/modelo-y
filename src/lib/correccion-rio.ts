import type { Observacion } from './rio-historia';
import { menosDias } from './rio-historia';
import { ESTACIONES_Y, type Correccion } from './pronostico-rio';
import { ARBOLES_CORRECCION } from './correccion-rio-datos';

/**
 * La corrección no lineal del Modelo Y, de 3 a 10 días.
 *
 * La regresión (`pronostico-rio.ts`) es una sola recta para todo el río, y
 * el río no responde igual bajo que alto: con Rosario en 1 m una onda llega
 * antes y casi entera, y con Rosario en 4 m se demora y se achata en las
 * islas. Además cada horizonte mira las estaciones de arriba con el retraso
 * de su agua (a 10 días, Corrientes de hace 4) y no ve lo que hicieron ayer.
 * Esta corrección aprende lo que a la regresión le queda sin explicar: unos
 * cientos de árboles de dos preguntas («¿Rosario está abajo de 2,10 m?»,
 * «¿Corrientes subió más de 3 cm ayer?») que suman o restan milímetros.
 *
 * Mira a Rosario y a las cinco estaciones de `ESTACIONES_Y` como están hoy:
 * la altura y cuánto cambiaron en 1, 3 y 10 días. Sin lluvia: con la que
 * cayó de verdad mejoraba lo mismo que sin ella.
 *
 * Ajustada con 2005-2021 sobre el error de la regresión de `MODELOS_MEDIO`,
 * y medida en 2022-2026, que no vio (`npm run ajuste-correccion`). Va
 * sólo hasta 10 días: a 14 y 17 mejoraba en 2022-2026 pero empeoraba 5-12 %
 * en 2016-2021 ajustando con 2005-2015. Como suma sobre la regresión y cada
 * árbol devuelve un valor acotado, en una crecida que no vio no se dispara:
 * a lo sumo deja de corregir.
 */

/** Días hacia atrás contra los que se mide el cambio de cada estación. */
const CAMBIOS = [1, 3, 10];

/** Las series que mira, en orden: Rosario primero. */
export const SERIES_CORRECCION = ['rosario', ...ESTACIONES_Y];

/** Nombre de cada predictor, en el orden de `predictoresCorreccion`. Para el ajuste y la página del modelo. */
export const NOMBRES_CORRECCION: string[] = [
  ...SERIES_CORRECCION.map((k) => `${k} altura`),
  ...SERIES_CORRECCION.flatMap((k) => CAMBIOS.map((n) => `${k} cambio ${n} d`)),
];

/**
 * Los predictores de la corrección para `hoy`: la altura de cada serie y su
 * cambio en 1, 3 y 10 días. Null si falta cualquiera: sin ellos el punto sale
 * sin corregir, con las bandas de siempre.
 */
export function predictoresCorreccion(series: Record<string, Observacion[]>, hoy: string): number[] | null {
  const niveles: number[] = [];
  const cambios: number[] = [];
  for (const k of SERIES_CORRECCION) {
    const s = series[k];
    if (!s) return null;
    const en = new Map<string, number>();
    // La primera de cada día, como `enDia` en el modelo.
    for (const o of s) if (!en.has(o.dia)) en.set(o.dia, o.metros);
    const n = en.get(hoy);
    if (n === undefined) return null;
    niveles.push(n);
    for (const dias of CAMBIOS) {
      const antes = en.get(menosDias(hoy, dias));
      if (antes === undefined) return null;
      cambios.push(n - antes);
    }
  }
  return [...niveles, ...cambios];
}

/**
 * Un árbol de dos preguntas, en diez números: [p0, c0, p1, c1, p2, c2, a, b,
 * c, d]. Si el predictor `p0` es ≤ `c0` se pregunta por `p1`/`c1` y sale `a`
 * o `b`; si no, por `p2`/`c2` y sale `c` o `d`.
 */
export type Arbol = number[];

/** La suma de todos los árboles para una fila de predictores, en metros. */
export function sumarArboles(arboles: Arbol[], x: number[]): number {
  let s = 0;
  for (const t of arboles) {
    s += x[t[0]] <= t[1] ? (x[t[2]] <= t[3] ? t[6] : t[7]) : x[t[4]] <= t[5] ? t[8] : t[9];
  }
  return s;
}

/** Horizontes que tienen corrección. */
export const HORIZONTES_CORRECCION = Object.keys(ARBOLES_CORRECCION).map(Number);

/**
 * Cuánto hay que sumarle a la regresión de `MODELOS_MEDIO` a `horizonte`
 * días, en metros. Null si ese horizonte no tiene corrección o falta un dato.
 */
export const correccionRio: Correccion = (series, hoy, horizonte) => {
  const arboles = ARBOLES_CORRECCION[horizonte];
  if (!arboles) return null;
  const x = predictoresCorreccion(series, hoy);
  return x === null ? null : sumarArboles(arboles, x);
};
