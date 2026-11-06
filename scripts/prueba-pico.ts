/**
 * A 14 y 17 días el Modelo Y se apoya en la altura de Corrientes de hoy, y
 * con Corrientes alta pronostica Rosario alto aunque el pico ya haya pasado
 * (noviembre de 2026: Corrientes bajó de 7,42 a 7,02 y el escenario seguía
 * subiendo hasta 4,75 m). ¿Qué predictor dice «el pico ya pasó» sin empeorar
 * el resto?
 *
 * Candidatos, sumados a la regresión de las cinco estaciones (sin lluvia, para
 * comparar parejo): cuánto bajó cada estación desde su máximo de los últimos
 * 20 días, el cambio de Corrientes en 10 días, el de Rosario en 7, y la
 * altura de Corrientes al cuadrado (la onda se achata más cuanto más alta).
 * Ajuste 2005-2021, prueba 2022-2026, la crecida de octubre de 2026 y lo que
 * diría hoy. Lee `.cache/ajuste-lluvia-rio/`. Corre con `npm run prueba-pico`.
 */
import { menosDias } from '../src/lib/rio-historia';
import { ESTACIONES_Y, RETARDOS } from '../src/lib/pronostico-rio';
import { fecha, series } from './datos-ajuste';

const idx: Record<string, Map<string, number>> = Object.fromEntries(
  Object.entries(series).map(([k, s]) => [k, new Map(s.map((o) => [o.dia, o.metros]))]),
);
const v = (k: string, d: string) => idx[k]?.get(d);
const cambio = (k: string, d: string, n: number) => {
  const a = v(k, d);
  const b = v(k, menosDias(d, n));
  return a === undefined || b === undefined ? undefined : a - b;
};
/** Cuánto está por debajo de su máximo de los últimos `n` días (0 si está en el máximo). */
const bajoMax = (k: string, d: string, n = 20) => {
  const a = v(k, d);
  if (a === undefined) return undefined;
  let m = -Infinity;
  for (let i = 0; i <= n; i++) {
    const x = v(k, menosDias(d, i));
    if (x !== undefined && x > m) m = x;
  }
  return a - m;
};

/** La fila de siempre: 1, Rosario y por estación nivel y cambio en 3 días (las que pasaron, de hoy). */
function base(d: string, h: number): number[] | null {
  const r = v('rosario', d);
  if (r === undefined) return null;
  const x = [1, r];
  for (const k of ESTACIONES_Y) {
    const dia = menosDias(d, Math.max(0, RETARDOS[k] - h));
    const n = v(k, dia);
    const c = cambio(k, dia, 3);
    if (n === undefined || c === undefined) return null;
    x.push(n, c);
  }
  return x;
}

type Extra = { nombre: string; f: (d: string, h: number) => (number | undefined)[] };
const EXTRAS: Extra[] = [
  { nombre: 'nada (el de hoy)', f: () => [] },
  { nombre: 'Corrientes bajo su máximo de 20 días', f: (d) => [bajoMax('corrientes', d)] },
  { nombre: 'las 5 bajo su máximo de 20 días', f: (d) => ESTACIONES_Y.map((k) => bajoMax(k, d)) },
  { nombre: 'Corrientes: cambio en 10 días', f: (d) => [cambio('corrientes', d, 10)] },
  { nombre: 'Rosario: cambio en 7 días', f: (d) => [cambio('rosario', d, 7)] },
  { nombre: 'Corrientes al cuadrado', f: (d) => { const c = v('corrientes', d); return [c === undefined ? undefined : c * c]; } },
  {
    nombre: 'bajo máximo (5) + cambio 10 d + Corr²',
    f: (d) => {
      const c = v('corrientes', d);
      return [...ESTACIONES_Y.map((k) => bajoMax(k, d)), cambio('corrientes', d, 10), c === undefined ? undefined : c * c];
    },
  },
];

function ols(X: number[][], y: number[]): number[] {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += X[r][i] * X[r][j];
      A[i][n] += X[r][i] * y[r];
    }
  }
  for (let i = 1; i < n; i++) A[i][i] += 1e-6;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}
const mae = (xs: number[]) => xs.reduce((a, e) => a + Math.abs(e), 0) / xs.length;

const ult = series.rosario.at(-1)!.dia;
console.log(`Datos hasta ${fecha}; hoy = ${ult}. Error medio (m): ajuste 2005-21 · prueba 2022-26 · pico pasado* · crecida oct-26 · lo que dice hoy`);
console.log('* días de prueba con Corrientes más de 20 cm bajo su máximo de 20 días y Rosario subiendo en la última semana');
for (const h of [10, 14, 17]) {
  // Los mismos días para todas las variantes.
  const fila = (d: string, e: Extra) => {
    const b = base(d, h);
    const x = e.f(d, h);
    return b && x.every((z) => z !== undefined) ? [...b, ...(x as number[])] : null;
  };
  const dias: string[] = [];
  for (let d = '2005-01-01'; d <= fecha; d = menosDias(d, -1)) {
    if (v('rosario', menosDias(d, -h)) === undefined) continue;
    if (EXTRAS.every((e) => fila(d, e))) dias.push(d);
  }
  const tr = dias.filter((d) => d <= '2021-12-31');
  const te = dias.filter((d) => d > '2021-12-31');
  const pico = te.filter((d) => (bajoMax('corrientes', d) ?? 0) < -0.2 && (cambio('rosario', d, 7) ?? 0) > 0);
  const oct = te.filter((d) => d >= '2026-10-01' && d <= '2026-10-31');
  console.log(`\n  ${h} días (prueba ${te.length}, pico pasado ${pico.length}, crecida ${oct.length})`);
  for (const e of EXTRAS) {
    const y = (d: string) => v('rosario', menosDias(d, -h))!;
    const b = ols(tr.map((d) => fila(d, e)!), tr.map(y));
    const p = (d: string) => fila(d, e)!.reduce((a, xi, i) => a + xi * b[i], 0);
    const err = (ds: string[]) => ds.map((d) => p(d) - y(d));
    const xh = (() => {
      const bb = base(ult, h);
      const x = e.f(ult, h);
      return bb && x.every((z) => z !== undefined) ? [...bb, ...(x as number[])].reduce((a, xi, i) => a + xi * b[i], 0) : null;
    })();
    console.log(
      `    ${e.nombre.padEnd(40)} ${mae(err(tr)).toFixed(3)} · ${mae(err(te)).toFixed(3)} · ${mae(err(pico)).toFixed(3)} · ${oct.length ? mae(err(oct)).toFixed(3) : '  —  '} · ${xh === null ? '—' : xh.toFixed(2)} el ${menosDias(ult, 1 - h)}`,
    );
  }
}
