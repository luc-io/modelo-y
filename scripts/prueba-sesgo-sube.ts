/**
 * ¿Ayuda o empeora la corrección por régimen de Corrientes (`SESGOS`) en las
 * crecidas? En octubre de 2026, con Corrientes +2,4 m en 10 días, el
 * escenario a 7 días se pasó por ~20 cm: la regresión sola erraba 4-8 cm y
 * la corrección «sube» le sumaba 16.
 *
 * Diagnóstico del error de la regresión cruda en los días «sube», por cómo
 * venían Corrientes, Reconquista y Rosario; y variantes de la corrección,
 * todas ajustadas con 2005-2021 y medidas en 2022-2026 (fuera de muestra) y
 * en la crecida de octubre de 2026. Lee `.cache/ajuste-lluvia-rio/` (correr
 * antes `npm run ajuste-lluvia`). Corre con `npm run sesgo-sube`.
 */
import { menosDias } from '../src/lib/rio-historia';
import { MODELOS, MODELOS_LLUVIA, SESGOS, SESGOS_LLUVIA, cambioCorrientes, regimenCorrientes, regresion, type ModeloRio, type Regimen } from '../src/lib/pronostico-rio';
import type { LluviaTramo } from '../src/lib/lluvia-tramo';
import { fecha, lluviaEcmwf, lluviaEra5, rosario, series } from './datos-ajuste';

const idx: Record<string, Map<string, number>> = Object.fromEntries(
  Object.entries(series).map(([k, s]) => [k, new Map(s.map((o) => [o.dia, o.metros]))]),
);
const cambio = (k: string, d: string, n: number) => {
  const a = idx[k].get(d) ?? idx[k].get(menosDias(d, 1));
  const b = idx[k].get(menosDias(d, n)) ?? idx[k].get(menosDias(d, n + 1));
  return a === undefined || b === undefined ? null : a - b;
};

const mediana = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const o = [...xs].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
const mae = (xs: number[]) => xs.reduce((a, e) => a + Math.abs(e), 0) / xs.length;
const f2 = (v: number) => (Number.isNaN(v) ? '  —  ' : (v >= 0 ? '+' : '') + v.toFixed(2));

interface Fila {
  d: string;
  e: number; // crudo - real
  r: Regimen;
  c10: number;
  q10: number; // Reconquista
  ros5: number;
  /** Días seguidos (hasta hoy) con Corrientes en «sube». */
  racha: number;
}

function filas(m: ModeloRio, lluvia: LluviaTramo | null, desde: string, hasta: string): Fila[] {
  const out: Fila[] = [];
  let racha = 0;
  for (let d = desde; d <= hasta; d = menosDias(d, -1)) {
    const r = regimenCorrientes(series.corrientes, d);
    racha = r === 'sube' ? racha + 1 : 0;
    const real = rosario.get(menosDias(d, -m.horizonte));
    if (real === undefined || !r) continue;
    const c = regresion(series, d, m, lluvia ?? undefined);
    const c10 = cambioCorrientes(series.corrientes, d);
    const q10 = cambio('reconquista', d, 10);
    const ros5 = cambio('rosario', d, 5);
    if (c === null || c10 === null || q10 === null || ros5 === null) continue;
    out.push({ d, e: c - real, r, c10, q10, ros5, racha });
  }
  return out;
}

/** Mínimos cuadrados con un poco de ridge, por eliminación de Gauss. */
function ols(X: number[][], y: number[], ridge = 1e-3): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((x, n) => {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
      A[i][k] += x[i] * y[n];
    }
  });
  for (let i = 0; i < k; i++) A[i][i] += ridge * X.length;
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let j = i + 1; j < k; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]];
    for (let j = i + 1; j < k; j++) {
      const f = A[j][i] / A[i][i];
      for (let c = i; c <= k; c++) A[j][c] -= f * A[i][c];
    }
  }
  const b = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = A[i][k];
    for (let j = i + 1; j < k; j++) s -= A[i][j] * b[j];
    b[i] = s / A[i][i];
  }
  return b;
}

const sube = (f: Fila) => f.r === 'sube';
const reqSube = (f: Fila) => f.q10 > 0.3;

function diagnostico(nombre: string, fs: Fila[]) {
  const s = fs.filter(sube);
  console.log(`\n  ${nombre}: error crudo (pron − real) en días «sube», mediana (n)`);
  const grupo = (rot: string, xs: Fila[]) =>
    console.log(`    ${rot.padEnd(42)} ${f2(mediana(xs.map((f) => f.e)))}  (${xs.length})`);
  grupo('todos los «sube»', s);
  grupo('Corrientes +0,4 a +1 m', s.filter((f) => f.c10 <= 1));
  grupo('Corrientes +1 a +2 m', s.filter((f) => f.c10 > 1 && f.c10 <= 2));
  grupo('Corrientes > +2 m', s.filter((f) => f.c10 > 2));
  grupo('Reconquista ya subió > 30 cm en 10 d', s.filter(reqSube));
  grupo('Reconquista todavía no (≤ 30 cm)', s.filter((f) => !reqSube(f)));
  grupo('Rosario sube > 10 cm en 5 d', s.filter((f) => f.ros5 > 0.1));
  grupo('Rosario quieto o bajando', s.filter((f) => f.ros5 <= 0.1));
  grupo('primeros 7 días de la racha', s.filter((f) => f.racha <= 7));
  grupo('después de 7 días', s.filter((f) => f.racha > 7));
}

type Variante = { nombre: string; ajustar: (tr: Fila[]) => (f: Fila) => number };

const celdas = (clave: (f: Fila) => string): Variante['ajustar'] => (tr) => {
  const m = new Map<string, number>();
  for (const k of new Set(tr.map(clave))) m.set(k, mediana(tr.filter((f) => clave(f) === k).map((f) => f.e)));
  return (f) => m.get(clave(f)) ?? 0;
};

function variantes(h: number, publicado: Record<number, Record<Regimen, number>>): Variante[] {
  const rasgos = (f: Fila) => [1, f.c10, f.q10, f.ros5, f.r === 'sube' ? 1 : 0, f.r === 'baja' ? 1 : 0];
  return [
    { nombre: 'sin corrección', ajustar: () => () => 0 },
    { nombre: 'la publicada (medida en 2022-2026)', ajustar: () => (f) => publicado[h][f.r] },
    { nombre: 'publicada, «sube» sólo la 1.ª semana', ajustar: () => (f) => (f.r === 'sube' && f.racha > 7 ? 0 : publicado[h][f.r]) },
    { nombre: 'publicada, «sube» sólo si Corr ≤ 2 m', ajustar: () => (f) => (f.r === 'sube' && f.c10 > 2 ? 0 : publicado[h][f.r]) },
    {
      nombre: 'publicada, «sube» 1.ª semana y Corr ≤ 2 m',
      ajustar: () => (f) => (f.r === 'sube' && (f.racha > 7 || f.c10 > 2) ? 0 : publicado[h][f.r]),
    },
    { nombre: 'régimen × semana de la racha (2005-21)', ajustar: celdas((f) => `${f.r}/${f.r === 'sube' && f.racha > 7}`) },
    { nombre: 'régimen de Corrientes, ajustada en 2005-21', ajustar: celdas((f) => f.r) },
    { nombre: 'régimen × Reconquista subió', ajustar: celdas((f) => `${f.r}/${reqSube(f)}`) },
    { nombre: 'régimen × Rosario sube', ajustar: celdas((f) => `${f.r}/${f.ros5 > 0.1}`) },
    {
      nombre: 'lineal: Corr, Reconq, Rosario, régimen',
      ajustar: (tr) => {
        const b = ols(tr.map(rasgos), tr.map((f) => f.e));
        return (f) => rasgos(f).reduce((a, x, i) => a + x * b[i], 0);
      },
    },
  ];
}

function comparar(nombre: string, m: ModeloRio, lluvia: LluviaTramo | null, lluviaTr: LluviaTramo | null, publicado: Record<number, Record<Regimen, number>>, pruebaDesde: string) {
  // Se ajusta con la lluvia que cayó (ECMWF no llega a 2005-2021) y se mide con `lluvia`.
  const tr = filas(m, lluviaTr, '2005-01-01', '2021-12-31');
  const te = filas(m, lluvia, pruebaDesde, fecha);
  const ep = te.filter((f) => f.d >= '2026-10-10' && f.d <= '2026-10-30');
  const crecidas = (xs: Fila[]) => xs.filter((f) => f.r === 'sube' && (f.racha > 7 || f.c10 > 2));
  console.log(`\n${nombre}, ${m.horizonte} días · prueba desde ${pruebaDesde} (n ${te.length}, «sube» ${te.filter(sube).length}, crecida oct-26 ${ep.length})`);
  console.log(`  ${'variante'.padEnd(44)} todos   «sube»  sube larga/fuerte  crecida oct-26 (sesgo)   | 2005-21: todos  sube larga/fuerte`);
  for (const v of variantes(m.horizonte, publicado)) {
    const g = v.ajustar(tr);
    const err = (xs: Fila[]) => xs.map((f) => f.e - g(f));
    const e = err(te);
    const es = err(te.filter(sube));
    const ee = err(ep);
    const el = err(crecidas(te));
    const t1 = err(tr);
    const t2 = err(crecidas(tr));
    console.log(
      `  ${v.nombre.padEnd(44)} ${mae(e).toFixed(3)}  ${mae(es).toFixed(3)}  ${mae(el).toFixed(3)} (${crecidas(te).length})      ${ee.length ? `${mae(ee).toFixed(3)} (${f2(mediana(ee))})` : '—'}          | ${mae(t1).toFixed(3)}  ${mae(t2).toFixed(3)} (${t2.length})`,
    );
  }
  return { tr, te };
}

console.log(`Datos hasta ${fecha}.`);
for (const h of [3, 5, 7, 10, 14]) {
  const base = MODELOS.find((x) => x.horizonte === h)!;
  const { tr, te } = comparar('Base', base, null, null, SESGOS, '2022-01-01');
  if (h === 7) {
    diagnostico('2005-2021', tr);
    diagnostico('2022-2026', te);
  }
  const ml = MODELOS_LLUVIA.find((x) => x.horizonte === h);
  if (ml) {
    comparar('Con lluvia (ERA5)', ml, lluviaEra5, lluviaEra5, SESGOS_LLUVIA, '2022-01-01');
    comparar('Con lluvia (ECMWF, como en vivo)', ml, lluviaEcmwf, lluviaEra5, SESGOS_LLUVIA, '2024-02-15');
  }
}
