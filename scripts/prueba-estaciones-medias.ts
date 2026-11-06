/**
 * ¿Mejora el escenario probable si se suman las estaciones del medio del
 * tramo (Bella Vista, Esquina, Santa Elena, Hernandarias), que hoy tienen el
 * agua que llega a Rosario en 5 a 9 días? Y a 14 y 17 días, ¿ayuda mirar
 * cómo están hoy Goya, Reconquista y las de abajo, aunque su agua llegue
 * antes? (en noviembre de 2026 el pico ya había pasado Goya y Reconquista y
 * el de 14 días seguía subiendo porque sólo mira Corrientes).
 *
 * 1. Retardo de cada estación: el que maximiza la correlación entre su cambio
 *    en 3 días y el de Rosario L días después, en 2005-2021.
 * 2. Para cada horizonte, se ajusta por mínimos cuadrados en 2005-2021 la
 *    regresión de siempre y variantes con más estaciones (mismos
 *    predictores: nivel y cambio en 3 días), y se mide el error en 2022-2026,
 *    que el ajuste no vio, y en la crecida de octubre-noviembre de 2026.
 *    Todo sin lluvia ni corrección por régimen, para comparar parejo.
 *
 * Lee `.cache/ajuste-lluvia-rio/` (correr antes `npm run ajuste-lluvia`)
 * y baja ahí las estaciones que falten. Corre con `npm run estaciones-medias`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estacionRio, menosDias, traerSerie, type Observacion } from '../src/lib/rio-historia';
import { MODELOS, RETARDOS } from '../src/lib/pronostico-rio';
import { fecha, series as base } from './datos-ajuste';

const CACHE = join(__dirname, '..', '.cache', 'ajuste-lluvia-rio');
const EXTRA = ['bella-vista', 'esquina', 'santa-elena', 'hernandarias', 'santa-fe', 'diamante'];
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bajar(slug: string): Promise<Observacion[]> {
  const archivo = join(CACHE, `rio-${slug}-${fecha}.json`);
  if (existsSync(archivo)) return JSON.parse(readFileSync(archivo, 'utf8'));
  for (let i = 0; ; i++) {
    try {
      const s = await traerSerie(estacionRio(slug)!.serie, '2004-11-01', fecha);
      writeFileSync(archivo, JSON.stringify(s));
      return s;
    } catch (e) {
      if (i >= 4) throw e;
      await esperar(20_000 * (i + 1));
    }
  }
}

const mae = (xs: number[]) => xs.reduce((a, e) => a + Math.abs(e), 0) / xs.length;

function ols(X: number[][], y: number[], ridge = 1e-4): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((x, n) => {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
      A[i][k] += x[i] * y[n];
    }
  });
  for (let i = 1; i < k; i++) A[i][i] += ridge * X.length;
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

async function main() {
  const series: Record<string, Observacion[]> = { ...base };
  for (const k of EXTRA) {
    series[k] = await bajar(k);
    console.log(`  ${k}: ${series[k].length} días`);
    await esperar(1200);
  }
  const idx: Record<string, Map<string, number>> = Object.fromEntries(
    Object.entries(series).map(([k, s]) => [k, new Map(s.map((o) => [o.dia, o.metros]))]),
  );
  const v = (k: string, d: string) => idx[k]?.get(d);
  const d3 = (k: string, d: string) => {
    const a = v(k, d);
    const b = v(k, menosDias(d, 3));
    return a === undefined || b === undefined ? undefined : a - b;
  };

  // 1. Retardos por correlación de los cambios en 3 días, 2005-2021.
  const estaciones = ['corrientes', 'bella-vista', 'goya', 'reconquista', 'esquina', 'la-paz', 'santa-elena', 'hernandarias', 'parana', 'santa-fe', 'diamante'];
  const retardo: Record<string, number> = {};
  console.log(`\nDatos hasta ${fecha}. Retardo hasta Rosario (correlación de cambios en 3 días, 2005-2021):`);
  for (const k of estaciones) {
    let mejor = { L: 0, r: -1 };
    for (let L = 0; L <= 20; L++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let d = '2005-01-01'; d <= '2021-12-31'; d = menosDias(d, -1)) {
        const x = d3(k, d);
        const y = d3('rosario', menosDias(d, -L));
        if (x === undefined || y === undefined) continue;
        xs.push(x);
        ys.push(y);
      }
      if (xs.length < 500) continue;
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxy = 0, sxx = 0, syy = 0;
      xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
      const r = sxy / Math.sqrt(sxx * syy);
      if (r > mejor.r) mejor = { L, r };
    }
    retardo[k] = mejor.L;
    console.log(`  ${k.padEnd(13)} ${String(mejor.L).padStart(2)} días (r ${mejor.r.toFixed(2)})${RETARDOS[k] !== undefined ? `   · el modelo usa ${RETARDOS[k]}` : '   · no está en el modelo'}`);
  }

  // 2. Variantes por horizonte. Cada estación entra con su nivel y su cambio
  // en 3 días, del día cuya agua llega a Rosario en el horizonte (o de hoy si
  // ya pasó: retardo < horizonte).
  const fila = (d: string, h: number, usa: string[], ret: Record<string, number>): number[] | null => {
    const r = v('rosario', d);
    if (r === undefined) return null;
    const x = [1, r];
    for (const k of usa) {
      const dia = menosDias(d, Math.max(0, ret[k] - h));
      const n = v(k, dia);
      const c = d3(k, dia);
      if (n === undefined || c === undefined) return null;
      x.push(n, c);
    }
    return x;
  };

  const MODELO = ['corrientes', 'goya', 'reconquista', 'la-paz', 'parana'];
  const variantes = (h: number) => {
    const actual = MODELOS.find((m) => m.horizonte === h)?.usa ?? ['corrientes'];
    return [
      { nombre: 'el de hoy', usa: actual, ret: RETARDOS as Record<string, number> },
      // Las mismas cinco estaciones que ya baja el modelo, todas, y las que ya pasaron con su dato de hoy.
      { nombre: 'las 5 del modelo, con su dato de hoy', usa: MODELO, ret: RETARDOS as Record<string, number> },
      { nombre: 'las 5 + Santa Fe y Diamante', usa: [...MODELO, 'santa-fe', 'diamante'], ret: RETARDOS as Record<string, number> },
      { nombre: 'todas (11), retardos medidos', usa: estaciones, ret: retardo },
      { nombre: 'todas (11), retardos del modelo', usa: estaciones, ret: { ...retardo, ...RETARDOS } },
    ];
  };

  const crecida = (d: string) => d >= '2026-10-01' && d <= '2026-10-31';
  console.log('\nError medio de la regresión (sin lluvia ni corrección), m, sobre los mismos días para todas: ajuste 2005-21 · prueba 2022-26 · crecida oct-26');
  for (const h of [3, 5, 7, 10, 14, 17]) {
    const vs = variantes(h);
    // Sólo los días en que todas las variantes se pueden calcular.
    const dias: string[] = [];
    for (let d = '2005-01-01'; d <= fecha; d = menosDias(d, -1)) {
      if (v('rosario', menosDias(d, -h)) === undefined) continue;
      if (vs.every((vv) => fila(d, h, vv.usa, vv.ret) !== null)) dias.push(d);
    }
    const ntr = dias.filter((d) => d <= '2021-12-31').length;
    console.log(`\n  ${h} días (n ajuste ${ntr}, prueba ${dias.length - ntr}, crecida ${dias.filter(crecida).length})`);
    for (const vv of vs) {
      const X = (d: string) => fila(d, h, vv.usa, vv.ret)!;
      const y = (d: string) => v('rosario', menosDias(d, -h))!;
      const tr = dias.filter((d) => d <= '2021-12-31');
      const te = dias.filter((d) => d > '2021-12-31');
      const b = ols(tr.map(X), tr.map(y));
      const err = (ds: string[]) => ds.map((d) => X(d).reduce((a, xi, i) => a + xi * b[i], 0) - y(d));
      const ep = err(te.filter(crecida));
      // Lo que diría con el último dato de Rosario (el día de la serie, que es el del cuadro).
      const ult = series.rosario.at(-1)!.dia;
      const xh = fila(ult, h, vv.usa, vv.ret);
      const hoyDice = xh ? xh.reduce((a, xi, i) => a + xi * b[i], 0).toFixed(2) : '  —';
      console.log(`    ${vv.nombre.padEnd(40)} ${mae(err(tr)).toFixed(3)} · ${mae(err(te)).toFixed(3)} · ${ep.length ? mae(ep).toFixed(3) : '  —  '}   hoy dice ${hoyDice} para el ${menosDias(ult, 1 - h)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
