/**
 * ¿Se suman la lluvia del tramo argentino y lo que suelta Yacyretá? Cuatro
 * variantes en los mismos días, ajustadas con 2005-2021 y medidas desde
 * 2024-02-15 con lo que ECMWF de verdad pronosticaba:
 *   base               los predictores del Modelo Y (a 17 y 21, Rosario y Corrientes de hoy)
 *   + lluvia           pasada y futura del tramo, como en producción (`lluviaDesdeDias`)
 *   + Yacyretá         caudal efluente del último día disponible y su cambio en 3 días
 *   + lluvia + Yacyretá
 *
 * Lee lo que bajaron `npm run ajuste-lluvia-rio` (ERA5 y ECMWF archivado) y
 * `scripts/prueba-represas.ts` (ríos y Yacyretá) el mismo día: correlos antes.
 * No toca producción. `npx tsx scripts/prueba-represas-lluvia.ts`
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { menosDias, type Observacion } from '../src/lib/rio-historia';
import { MODELOS, RETARDOS, predictores } from '../src/lib/pronostico-rio';
import { DIAS_PRONOSTICO, PUNTOS_TRAMO, lluviaDesdeDias, lluviaTipica, type LluviaTramo } from '../src/lib/lluvia-tramo';

const hoy = new Date().toISOString().slice(0, 10);
const LLUVIA = join(__dirname, '..', '.cache', 'ajuste-lluvia-rio');
const REPRESAS = join(__dirname, '..', '.cache', 'prueba-represas');
const DESDE_PRUEBA = '2024-02-15';
const HORIZONTES = [7, 10, 14, 17, 21];

function leer<T>(archivo: string): T {
  if (!existsSync(archivo)) throw new Error(`falta ${archivo}: corré antes ajuste-lluvia-rio y prueba-represas`);
  return JSON.parse(readFileSync(archivo, 'utf8'));
}

function promedio(puntos: Map<string, number>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const [d] of puntos[0]) {
    const vs = puntos.map((p) => p.get(d));
    if (vs.every((v): v is number => v !== undefined)) m.set(d, vs.reduce((a, v) => a + v, 0) / vs.length);
  }
  return m;
}

function era5(): Map<string, number> {
  return promedio(
    PUNTOS_TRAMO.map(([lon, lat]) => {
      const j = leer<{ daily: { time: string[]; precipitation_sum: (number | null)[] } }>(join(LLUVIA, `era5-${lon}_${lat}-${hoy}.json`));
      return new Map(j.daily.time.flatMap((t, i) => (j.daily.precipitation_sum[i] === null ? [] : [[t, j.daily.precipitation_sum[i]!] as [string, number]])));
    }),
  );
}

/** Día → [pronosticado con 1 día, …, 7 días de anticipación], promedio del tramo. */
function ecmwf(): Map<string, number[]> {
  const vars = Array.from({ length: DIAS_PRONOSTICO }, (_, i) => `precipitation_previous_day${i + 1}`);
  const porAnt: Map<string, number>[][] = vars.map(() => []);
  for (const [lon, lat] of PUNTOS_TRAMO) {
    const j = leer<{ hourly: Record<string, (number | null)[]> & { time: string[] } }>(join(LLUVIA, `ecmwf-${lon}_${lat}-${hoy}.json`));
    vars.forEach((v, k) => {
      const suma = new Map<string, { s: number; n: number }>();
      j.hourly.time.forEach((t, i) => {
        const x = j.hourly[v][i];
        if (x === null) return;
        const a = suma.get(t.slice(0, 10)) ?? { s: 0, n: 0 };
        a.s += x;
        a.n++;
        suma.set(t.slice(0, 10), a);
      });
      porAnt[k].push(new Map([...suma].filter(([, a]) => a.n === 24).map(([d, a]) => [d, a.s])));
    });
  }
  const medias = porAnt.map(promedio);
  const m = new Map<string, number[]>();
  for (const [d] of medias[0]) {
    const vs = medias.map((x) => x.get(d));
    if (vs.every((v): v is number => v !== undefined)) m.set(d, vs);
  }
  return m;
}

/** La lluvia como se sabía el día `d`, igual que en `ajuste-lluvia-rio`. */
function archivada(ec: Map<string, number[]>): LluviaTramo {
  return {
    pasada(d) {
      let s = 0;
      for (let k = 0; k < 7; k++) {
        const v = ec.get(menosDias(d, k))?.[0];
        if (v === undefined) return null;
        s += v;
      }
      return s;
    },
    futura(d, h) {
      let s = 0;
      for (let k = 1; k <= h; k++) {
        const dia = menosDias(d, -k);
        if (k <= DIAS_PRONOSTICO) {
          const v = ec.get(dia)?.[k - 1];
          if (v === undefined) return null;
          s += v;
        } else s += lluviaTipica(dia);
      }
      return s;
    },
  };
}

function ajustar(X: number[][], y: number[]): number[] {
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

function percentil(xs: number[], p: number): number {
  const o = [...xs].sort((a, b) => a - b);
  const i = (o.length - 1) * p;
  const a = Math.floor(i);
  return o[a] + (o[Math.min(a + 1, o.length - 1)] - o[a]) * (i - a);
}
const mae = (e: number[]) => e.reduce((a, x) => a + Math.abs(x), 0) / e.length;

function main() {
  const series: Record<string, Observacion[]> = {};
  for (const k of ['rosario', ...Object.keys(RETARDOS)]) series[k] = leer(join(REPRESAS, `ina-${k}-${hoy}.json`));
  const rosario = new Map(series.rosario.map((o) => [o.dia, o.metros]));
  const corrientes = new Map(series.corrientes.map((o) => [o.dia, o.metros]));
  const yacy = new Map(leer<Observacion[]>(join(REPRESAS, `ina-yacyreta-efluente-${hoy}.json`)).map((o) => [o.dia, o.metros]));
  const lluviaAjuste = lluviaDesdeDias(era5());
  const lluviaPrueba = archivada(ecmwf());

  type Var = 'base' | '+ lluvia' | '+ Yacyretá' | '+ lluvia + Yacyretá' | '+ lluvia + ΔYacy 3d' | '+ lluvia + ΔYacy 3d y 7d';
  const VARS: Var[] = ['base', '+ lluvia', '+ Yacyretá', '+ lluvia + Yacyretá', '+ lluvia + ΔYacy 3d', '+ lluvia + ΔYacy 3d y 7d'];
  const fila = (d: string, h: number, v: Var, ll: LluviaTramo): number[] | null => {
    let x: number[] | null;
    const m = MODELOS.find((mm) => mm.horizonte === h);
    if (m) x = predictores(series, d, m);
    else {
      // Más allá de 14 días ninguna estación alcanza: Rosario y Corrientes de hoy.
      const r = rosario.get(d);
      const c = corrientes.get(d);
      const c3 = corrientes.get(menosDias(d, 3));
      x = r === undefined || c === undefined || c3 === undefined ? null : [1, r, c, c - c3];
    }
    if (!x) return null;
    if (v === '+ lluvia' || v.startsWith('+ lluvia +')) {
      const p = ll.pasada(d);
      const f = ll.futura(d, h);
      if (p === null || f === null) return null;
      x.push(p / 100, f / 100);
    }
    if (v === '+ Yacyretá' || v === '+ lluvia + Yacyretá') {
      const y = yacy.get(d);
      const y3 = yacy.get(menosDias(d, 3));
      if (y === undefined || y3 === undefined) return null;
      x.push(y / 10_000, (y - y3) / 10_000);
    }
    if (v === '+ lluvia + ΔYacy 3d' || v === '+ lluvia + ΔYacy 3d y 7d') {
      // Sólo el cambio: la onda que viene, sin el nivel que repite a Corrientes.
      const y = yacy.get(d);
      const y3 = yacy.get(menosDias(d, 3));
      const y7 = yacy.get(menosDias(d, 7));
      if (y === undefined || y3 === undefined || y7 === undefined) return null;
      x.push((y - y3) / 10_000);
      if (v === '+ lluvia + ΔYacy 3d y 7d') x.push((y - y7) / 10_000);
    }
    return x;
  };

  console.log(`\nAjuste 2005-2021 con ERA5; prueba desde ${DESDE_PRUEBA} con ECMWF. Mismos días en cada plazo.\n`);
  for (const h of HORIZONTES) {
    const real = (d: string) => rosario.get(menosDias(d, -h));
    const ajuste: string[] = [];
    const prueba: string[] = [];
    for (let d = '2005-01-01'; d <= hoy; d = menosDias(d, -1)) {
      if (real(d) === undefined) continue;
      if (d < '2022-01-01') {
        if (VARS.every((v) => fila(d, h, v, lluviaAjuste) !== null)) ajuste.push(d);
      } else if (d >= DESDE_PRUEBA && VARS.every((v) => fila(d, h, v, lluviaPrueba) !== null)) prueba.push(d);
    }
    const ep = prueba.map((d) => rosario.get(d)! - real(d)!);
    const lineas = [`  ${'persistencia'.padEnd(20)} mae ${mae(ep).toFixed(3)}  banda ${(percentil(ep, 0.9) - percentil(ep, 0.1)).toFixed(2)}`];
    let maeBase = 0;
    for (const v of VARS) {
      const b = ajustar(ajuste.map((d) => fila(d, h, v, lluviaAjuste)!), ajuste.map((d) => real(d)!));
      const e = prueba.map((d) => fila(d, h, v, lluviaPrueba)!.reduce((a, xi, i) => a + xi * b[i], 0) - real(d)!);
      if (v === 'base') maeBase = mae(e);
      if (h === 14 || h === 17) lineas.push(`      coef: ${b.slice(-3).map((c) => c.toFixed(3)).join(' ')}`);
      lineas.push(
        `  ${v.padEnd(20)} mae ${mae(e).toFixed(3)}  banda ${(percentil(e, 0.9) - percentil(e, 0.1)).toFixed(2)}${v === 'base' ? '' : `  (${Math.round((mae(e) / maeBase - 1) * 100)} %)`}`,
      );
    }
    console.log(`${h} días (ajuste n ${ajuste.length}, prueba n ${prueba.length})`);
    console.log(lineas.join('\n'));
  }
}

main();
