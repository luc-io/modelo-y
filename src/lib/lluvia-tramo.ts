import { menosDias } from './rio-historia';

/**
 * La lluvia sobre el tramo argentino del Paraná, entre Corrientes y Rosario:
 * el Salado santafesino, el norte de Santa Fe y el sureste del Chaco por la
 * derecha; Corrientes y el norte de Entre Ríos (Corriente, Feliciano,
 * Guayquiraró) por la izquierda. Esa agua llega a Rosario en pocos días y
 * ninguna estación de las que mira el escenario probable la ve antes.
 *
 * Probado con `scripts/prueba-lluvia.ts` (octubre de 2026): con el
 * pronóstico de ECMWF el error a 7-14 días baja 8-11 %. La lluvia del Alto
 * Paraná y del Paraguay llega después de los 14 días, y la humedad del suelo
 * mejoraba milímetros y pedía una segunda fuente: no están.
 */

/** Puntos (lon, lat) que se promedian. */
export const PUNTOS_TRAMO: [number, number][] = [
  [-61.0, -31.0],
  [-61.5, -29.5],
  [-60.0, -28.5],
  [-58.8, -29.5],
  [-59.3, -31.0],
  [-58.0, -28.5],
];

/** Días de pronóstico que se usan; después, la lluvia típica de la época. Es lo que guarda el archivo con que se midió. */
export const DIAS_PRONOSTICO = 7;

/**
 * Lo que el escenario probable necesita saber de la lluvia del tramo, en mm
 * promedio de los puntos. `hoy` es el último día con altura de Rosario.
 */
export interface LluviaTramo {
  /** La de los 7 días hasta `hoy` inclusive. */
  pasada(hoy: string): number | null;
  /** La esperada entre mañana y `hoy + horizonte`. */
  futura(hoy: string, horizonte: number): number | null;
}

/**
 * Lluvia media diaria del tramo para cada día del año (0 = 1 de enero), de
 * ERA5 2005-2021 con ±15 días de ventana. La genera `npm run ajuste-lluvia-rio`.
 */
export const CLIMA_TRAMO: number[] = [
  4.72, 4.71, 4.7, 4.44, 4.48, 4.45, 4.28, 4.18, 4.28, 4.23, 4.19, 4.13,
  4.19, 4.23, 4.3, 4.31, 4.37, 4.35, 4.33, 4.4, 4.46, 4.44, 4.3, 4.32,
  4.2, 4.19, 4.02, 3.95, 3.89, 3.87, 3.72, 3.75, 3.75, 3.79, 3.9, 3.91,
  4, 4.13, 4.22, 4.17, 4.3, 4.31, 4.25, 4.22, 4.27, 4.41, 4.51, 4.49,
  4.44, 4.36, 4.24, 4.24, 4.28, 4.24, 4.2, 4.26, 4.15, 4.18, 4.17, 4.23,
  4.22, 4.22, 4.24, 4.23, 4.16, 4.04, 3.92, 3.87, 3.78, 3.76, 3.75, 3.63,
  3.62, 3.63, 3.63, 3.62, 3.47, 3.34, 3.35, 3.41, 3.53, 3.59, 3.56, 3.55,
  3.65, 3.88, 3.77, 3.78, 3.85, 3.87, 3.75, 3.69, 3.66, 3.73, 3.84, 3.83,
  3.79, 3.86, 3.87, 3.96, 3.84, 3.85, 3.83, 3.82, 3.78, 3.74, 3.76, 3.86,
  3.87, 3.87, 3.85, 3.74, 3.73, 3.74, 3.74, 3.64, 3.47, 3.54, 3.52, 3.36,
  3.3, 3.34, 3.38, 3.36, 3.19, 3.06, 3, 3.06, 3.09, 3.02, 2.88, 2.87,
  2.82, 2.86, 2.84, 2.83, 2.79, 2.68, 2.55, 2.47, 2.4, 2.41, 2.38, 2.29,
  2.24, 2.15, 2.15, 2.07, 2, 1.98, 2.05, 2.09, 2.07, 2.02, 2.01, 1.99,
  1.95, 1.95, 1.91, 1.84, 1.89, 1.97, 2.02, 2.06, 2.02, 1.95, 1.91, 1.92,
  1.88, 1.85, 1.93, 1.93, 1.9, 1.95, 1.95, 1.89, 1.88, 1.85, 1.83, 1.82,
  1.82, 1.74, 1.7, 1.72, 1.74, 1.76, 1.8, 1.83, 1.8, 1.76, 1.79, 1.71,
  1.6, 1.55, 1.5, 1.47, 1.47, 1.53, 1.56, 1.55, 1.5, 1.4, 1.34, 1.32,
  1.33, 1.42, 1.45, 1.5, 1.59, 1.63, 1.61, 1.58, 1.63, 1.7, 1.76, 1.79,
  1.76, 1.75, 1.67, 1.67, 1.64, 1.64, 1.66, 1.68, 1.73, 1.79, 1.82, 1.86,
  1.88, 1.95, 1.98, 2.06, 2.12, 2.19, 2.26, 2.27, 2.28, 2.33, 2.31, 2.2,
  2.29, 2.41, 2.41, 2.39, 2.47, 2.38, 2.37, 2.4, 2.38, 2.42, 2.46, 2.47,
  2.41, 2.37, 2.46, 2.47, 2.47, 2.53, 2.58, 2.58, 2.61, 2.73, 2.74, 2.77,
  2.82, 2.83, 2.84, 2.92, 3.02, 3.09, 3.2, 3.26, 3.2, 3.32, 3.36, 3.28,
  3.39, 3.44, 3.48, 3.51, 3.62, 3.74, 3.84, 4.01, 4.11, 4.04, 4.25, 4.3,
  4.28, 4.29, 4.49, 4.46, 4.45, 4.56, 4.53, 4.42, 4.33, 4.39, 4.35, 4.27,
  4.28, 4.3, 4.2, 4.22, 4.25, 4.34, 4.31, 4.42, 4.38, 4.47, 4.45, 4.43,
  4.34, 4.37, 4.38, 4.51, 4.58, 4.41, 4.55, 4.52, 4.51, 4.37, 4.35, 4.35,
  4.16, 4.13, 4.18, 4.29, 4.22, 4.25, 4.26, 4.25, 4.26, 4.26, 4.28, 4.34,
  4.28, 4.37, 4.54, 4.52, 4.46, 4.6, 4.63, 4.58, 4.56, 4.51, 4.46, 4.41,
  4.36, 4.12, 4.19, 4.17, 4.11, 4.16, 4.13, 4.21, 4.29, 4.47, 4.43, 4.58,
  4.58, 4.71, 4.74, 4.69, 4.72, 4.83,
];

/** Día del año, 0 a 365. */
const diaDelAnio = (d: string) => Math.floor((Date.parse(d) - Date.parse(`${d.slice(0, 4)}-01-01`)) / 86_400_000);

export const lluviaTipica = (d: string) => CLIMA_TRAMO[diaDelAnio(d)];

/**
 * Arma la lluvia del tramo desde lluvias diarias: las de los días pasados y
 * las pronosticadas (lo que da Open-Meteo con `past_days`). Del día 8 en
 * adelante usa la típica aunque haya pronóstico: así se midió, y a esa
 * distancia el pronóstico ya casi no sabe más que la época.
 */
export function lluviaDesdeDias(dias: Map<string, number>, tipica: (d: string) => number = lluviaTipica): LluviaTramo {
  return {
    pasada(hoy) {
      let s = 0;
      for (let k = 0; k < 7; k++) {
        const v = dias.get(menosDias(hoy, k));
        if (v === undefined) return null;
        s += v;
      }
      return s;
    },
    futura(hoy, horizonte) {
      let s = 0;
      for (let k = 1; k <= horizonte; k++) {
        const dia = menosDias(hoy, -k);
        if (k <= DIAS_PRONOSTICO) {
          const v = dias.get(dia);
          if (v === undefined) return null;
          s += v;
        } else s += tipica(dia);
      }
      return s;
    },
  };
}
