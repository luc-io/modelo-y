import type { Observacion } from './rio-historia';
import { menosDias } from './rio-historia';
import type { LluviaTramo } from './lluvia-tramo';

/**
 * Pronóstico propio de altura para Rosario.
 *
 * NO es el pronóstico oficial. El INA publica el suyo con un modelo
 * hidrodinámico calibrado; esto es una regresión con retardos ajustada sobre
 * datos abiertos, y por eso siempre se muestra con su banda de error medida. Un número
 * sin margen invita a decidir con una precisión que no tiene, y acá la gente
 * mueve amarras.
 *
 * Cómo funciona: el agua tarda un tiempo conocido en bajar de cada estación a
 * Rosario —14 días desde Corrientes, 3 desde Paraná— así que la altura de hoy
 * río arriba ya contiene la de mañana acá. Los retardos salen de maximizar la
 * correlación sobre diez años; las correlaciones dan entre 0,93 y 0,99.
 *
 * Ajustado con 2005-2021 y medido contra 2022-2026, un período que no vio y
 * que incluye la bajante histórica. Le gana a la persistencia por 21-32%.
 */
export interface ModeloRio {
  horizonte: number;
  /** Estaciones que alcanzan a informar ese horizonte (retardo >= horizonte). */
  usa: string[];
  /** Ordenada, coeficiente de la altura propia, y por estación: nivel y tendencia a 3 días. */
  coef: number[];
  /** Error absoluto medio en 2022-2026, en metros. La banda que se muestra es `BANDAS`. */
  mae: number;
  /**
   * Suma la lluvia del tramo argentino (ver `lluvia-tramo.ts`): la de los 7
   * días previos y la pronosticada hasta el día del horizonte. Sus bandas y
   * sesgos son `BANDAS_LLUVIA` y `SESGOS_LLUVIA`, y su `mae` está medido con
   * el pronóstico real de ECMWF desde febrero de 2024.
   */
  lluvia?: true;
}

/** Días que tarda el agua en llegar de cada estación a Rosario. */
export const RETARDOS: Record<string, number> = {
  'corrientes': 14,
  'goya': 11,
  'reconquista': 10,
  'la-paz': 6,
  'parana': 3,
  'santa-fe': 2,
  'diamante': 2,
};

export const MODELOS: ModeloRio[] = [
  {
    horizonte: 3,
    usa: ['corrientes', 'goya', 'reconquista', 'la-paz', 'parana'],
    coef: [0.042669, 0.757081, -0.025604, 0.016579, 0.057714, -0.008403, -0.11215, 0.024511, 0.031697, -0.023548, 0.276752, 0.424398],
    mae: 0.104,
  },
  {
    horizonte: 5,
    usa: ['corrientes', 'goya', 'reconquista', 'la-paz'],
    coef: [-0.123046, 0.791499, -0.013676, 0.026928, -0.144048, 0.114116, 0.18381, -0.177557, 0.184281, 0.473285],
    mae: 0.145,
  },
  {
    horizonte: 7,
    usa: ['corrientes', 'goya', 'reconquista'],
    coef: [-0.324506, 0.727926, -0.170013, 0.046654, 0.057036, 0.005036, 0.463467, 0.195172],
    mae: 0.198,
  },
  {
    horizonte: 10,
    usa: ['corrientes', 'goya', 'reconquista'],
    coef: [-0.498483, 0.607458, -0.269431, 0.129176, 0.104784, -0.018873, 0.679093, 0.104681],
    mae: 0.214,
  },
  {
    horizonte: 14,
    usa: ['corrientes'],
    coef: [-0.105557, 0.614698, 0.347087, 0.080032],
    mae: 0.28,
  },
];

/**
 * Los mismos horizontes desde 7 días, con la lluvia del tramo argentino. A 3
 * y 5 días no mejora: el agua de los afluentes todavía no llegó. Ajustados con
 * 2005-2021 usando la lluvia que cayó (ERA5) y medidos con lo que de verdad
 * se pronosticaba (ECMWF, febrero de 2024 en adelante), con
 * `npm run ajuste-lluvia-rio`.
 */
export const MODELOS_LLUVIA: ModeloRio[] = [
  {
    horizonte: 7,
    usa: ['corrientes', 'goya', 'reconquista'],
    coef: [-0.422334, 0.696844, -0.196651, 0.06413, 0.155848, -0.028774, 0.413022, 0.16059, 0.179987, 0.200474],
    mae: 0.185,
    lluvia: true,
  },
  {
    horizonte: 10,
    usa: ['corrientes', 'goya', 'reconquista'],
    coef: [-0.611025, 0.588079, -0.273281, 0.137801, 0.224993, -0.069677, 0.561071, 0.093188, 0.170091, 0.275788],
    mae: 0.189,
    lluvia: true,
  },
  {
    horizonte: 14,
    usa: ['corrientes'],
    coef: [-0.247382, 0.596896, 0.345037, 0.043259, 0.260923, 0.306953],
    mae: 0.249,
    lluvia: true,
  },
];

/**
 * Percentiles 10 y 90 del error (pronosticado - real), en metros, por
 * horizonte y por régimen de Corrientes: entre los dos queda lo real 8 de cada
 * 10 veces. Reemplazan al ± del error absoluto medio, que era simétrico y
 * escondía que con Corrientes en crecida el modelo se queda corto (sesgo -18
 * cm a 7 días) y en bajante se pasa (+8 a +12 cm).
 *
 * Medidos con `npm run margen-rio` (scripts/margen-rio.ts) el 12/10/2026,
 * día por día de 2022 a 2026, que el ajuste no vio y que incluye la bajante
 * histórica: entre 456 y 720 pronósticos por casilla. En 2005-2021 el patrón
 * es el mismo pero más angosto, porque es la muestra con que se ajustó; usar
 * esa daría una banda optimista.
 */
export const BANDAS: Record<number, Record<Regimen, [number, number]>> = {
  3: { sube: [-0.14, 0.14], baja: [-0.11, 0.18], resto: [-0.13, 0.18] },
  5: { sube: [-0.29, 0.13], baja: [-0.14, 0.28], resto: [-0.24, 0.23] },
  7: { sube: [-0.51, 0.09], baja: [-0.18, 0.37], resto: [-0.31, 0.25] },
  10: { sube: [-0.49, 0.14], baja: [-0.22, 0.41], resto: [-0.39, 0.26] },
  14: { sube: [-0.57, 0.26], baja: [-0.34, 0.61], resto: [-0.46, 0.4] },
};

/**
 * Mediana del error (pronosticado - real), en metros, por horizonte y por
 * régimen de Corrientes: lo que la regresión se pasa (positivo) o se queda
 * corta (negativo) la mitad de las veces. `predecir` se la resta al número
 * central, que sin esto quedaba en un costado de su propia banda: con
 * Corrientes en crecida, 16 cm abajo a 7 días, y la línea "caía" al empalmar
 * con el pronóstico del INA. La mediana y no el promedio, por lo mismo que la
 * banda: los errores tienen cola y la cola no tiene que mover el centro.
 *
 * Medidas con `npm run margen-rio` el 13/10/2026 sobre los mismos datos y
 * período que `BANDAS` (2022-2026, fuera del ajuste). En 2005-2021 el sesgo
 * apunta para el mismo lado pero es la mitad o menos.
 */
export const SESGOS: Record<number, Record<Regimen, number>> = {
  3: { sube: 0.02, baja: 0.05, resto: 0.04 },
  5: { sube: -0.05, baja: 0.08, resto: 0.03 },
  7: { sube: -0.16, baja: 0.1, resto: -0.01 },
  10: { sube: -0.11, baja: 0.08, resto: -0.04 },
  14: { sube: -0.11, baja: 0.11, resto: 0.02 },
};

/** Como `BANDAS`, para `MODELOS_LLUVIA`, medidas con el pronóstico de ECMWF desde 2024-02-15. */
export const BANDAS_LLUVIA: Record<number, Record<Regimen, [number, number]>> = {
  7: { sube: [-0.46, 0.11], baja: [-0.18, 0.35], resto: [-0.27, 0.24] },
  10: { sube: [-0.45, 0.14], baja: [-0.22, 0.37], resto: [-0.32, 0.24] },
  14: { sube: [-0.55, 0.22], baja: [-0.27, 0.46], resto: [-0.37, 0.43] },
};

/** Como `SESGOS`, para `MODELOS_LLUVIA`, sobre los mismos días que `BANDAS_LLUVIA`. */
export const SESGOS_LLUVIA: Record<number, Record<Regimen, number>> = {
  7: { sube: -0.15, baja: 0.1, resto: 0.01 },
  10: { sube: -0.14, baja: 0.07, resto: -0.02 },
  14: { sube: -0.1, baja: 0.1, resto: 0.03 },
};

export interface Punto {
  /**
   * Día en que el río estaría a esa altura, a la mañana. El modelo predice el
   * número del cuadro de Prefectura, que sale fechado un día después de la
   * lectura (ver `automatico-ina.ts`); acá ya viene corregido.
   */
  dia: string;
  metros: number;
  /** Banda de error medida para ese horizonte y ese régimen, en metros. */
  min: number;
  max: number;
}

/**
 * Cómo viene Corrientes, que es lo que el modelo sigue peor. Cuando arriba
 * crece rápido, la regresión —lineal y ajustada mayormente con río tranquilo—
 * se queda corta; cuando baja, se pasa. Por eso la banda no es simétrica.
 */
export type Regimen = 'sube' | 'baja' | 'resto';
export const REGIMENES: Regimen[] = ['sube', 'baja', 'resto'];
/** Cambio de Corrientes en los 10 días previos que separa los regímenes, en metros. */
const SUBE = 0.4;
const BAJA = -0.15;

/**
 * Régimen según cuánto cambió Corrientes entre `hoy` y diez días antes. Tolera
 * un día de hueco en cada punta; si no hay con qué comparar, null.
 */
export function regimenCorrientes(s: Observacion[], hoy: string): Regimen | null {
  const cerca = (dia: string) => enDia(s, dia) ?? enDia(s, menosDias(dia, 1));
  const ahora = cerca(hoy);
  const antes = cerca(menosDias(hoy, 10));
  if (ahora === null || antes === null) return null;
  const c = ahora - antes;
  return c > SUBE ? 'sube' : c < BAJA ? 'baja' : 'resto';
}

const enDia = (s: Observacion[], dia: string) => s.find((o) => o.dia === dia)?.metros ?? null;

/**
 * Cuánto puede quedar lo real por debajo y por encima de la regresión cruda.
 * Sin régimen (falta Corrientes), la más ancha de las tres: no saber cómo
 * viene el río arriba no es motivo para achicar el margen.
 */
function banda(m: ModeloRio, r: Regimen | null): [number, number] {
  const b = (m.lluvia ? BANDAS_LLUVIA : BANDAS)[m.horizonte];
  if (r) return [-b[r][1], -b[r][0]];
  return [-Math.max(...REGIMENES.map((k) => b[k][1])), -Math.min(...REGIMENES.map((k) => b[k][0]))];
}

/**
 * La regresión sola, sin corregir el sesgo: es lo que mide
 * `scripts/margen-rio.ts`, porque `BANDAS` y `SESGOS` son errores de esto.
 * `series` son las observaciones por estación, `hoy` el último día con dato
 * de Rosario. Devuelve null si falta cualquier predictor: completar un hueco
 * con un supuesto sería inventar el pronóstico.
 */
export function regresion(
  series: Record<string, Observacion[]>,
  hoy: string,
  m: ModeloRio,
  lluvia?: LluviaTramo | null,
): number | null {
  const x = predictores(series, hoy, m, lluvia);
  if (x === null || x.length !== m.coef.length) return null;
  return m.coef.reduce((a, c, i) => a + c * x[i], 0);
}

/**
 * Los predictores de un modelo en el orden de `coef`: 1, la altura de
 * Rosario y, por estación, nivel y cambio en 3 días; si el modelo usa lluvia,
 * la pasada y la futura del tramo, en decenas de mm. Lo usa también el ajuste
 * (`scripts/ajuste-lluvia-rio.ts`), para que los coeficientes y la página no
 * puedan armar la fila distinto.
 */
export function predictores(
  series: Record<string, Observacion[]>,
  hoy: string,
  m: ModeloRio,
  lluvia?: LluviaTramo | null,
): number[] | null {
  const propio = enDia(series.rosario ?? [], hoy);
  if (propio === null) return null;

  const x: number[] = [1, propio];
  for (const k of m.usa) {
    const s = series[k];
    if (!s) return null;
    const dia = menosDias(hoy, RETARDOS[k] - m.horizonte);
    const nivel = enDia(s, dia);
    const antes = enDia(s, menosDias(dia, 3));
    if (nivel === null || antes === null) return null;
    x.push(nivel, nivel - antes);
  }
  if (m.lluvia) {
    const pasada = lluvia?.pasada(hoy) ?? null;
    const futura = lluvia?.futura(hoy, m.horizonte) ?? null;
    if (pasada === null || futura === null) return null;
    x.push(pasada / 100, futura / 100);
  }
  return x;
}

/**
 * Aplica un modelo: la regresión corrida por la mediana de su error en el
 * régimen de Corrientes, con la banda medida alrededor. La banda queda donde
 * estaba —sale de los mismos errores—; lo que se mueve es el número central
 * adentro de ella. Sin régimen no se corrige: no hay con qué saber para qué
 * lado.
 */
export function predecir(
  series: Record<string, Observacion[]>,
  hoy: string,
  m: ModeloRio,
  lluvia?: LluviaTramo | null,
): Punto | null {
  const crudo = regresion(series, hoy, m, lluvia);
  if (crudo === null) return null;
  const regimen = regimenCorrientes(series.corrientes ?? [], hoy);
  const b = banda(m, regimen);
  const metros = crudo - (regimen ? (m.lluvia ? SESGOS_LLUVIA : SESGOS)[m.horizonte][regimen] : 0);
  const r = (v: number) => Number(v.toFixed(2));
  return { dia: menosDias(hoy, 1 - m.horizonte), metros: r(metros), min: r(crudo + b[0]), max: r(crudo + b[1]) };
}

/**
 * Los cinco horizontes, saltando los que no se pueden calcular. Desde 7 días
 * usa el modelo con lluvia si hay lluvia del tramo; si no la hay (Open-Meteo
 * no respondió), el de siempre con su banda de siempre.
 */
export function pronosticar(series: Record<string, Observacion[]>, hoy: string, lluvia?: LluviaTramo | null): Punto[] {
  return MODELOS.map((m) => {
    const conLluvia = lluvia ? MODELOS_LLUVIA.find((x) => x.horizonte === m.horizonte) : undefined;
    return (conLluvia && predecir(series, hoy, conLluvia, lluvia)) || predecir(series, hoy, m);
  }).filter((p): p is Punto => p !== null);
}
