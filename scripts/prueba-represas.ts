/**
 * ¿Lo que sueltan las represas mejora el Modelo Y a 14 días, y lo deja llegar
 * a 17 y 21? Prueba con lo que de verdad erogaron:
 *   - Yacyretá: caudal efluente, serie 937 del INA (desde 1994).
 *   - Itaipú: vazão defluente diaria del ONS (dados_hidrologicos_di, CC BY 4.0).
 *
 * Primero mide cuánto tarda cada una en llegar a Rosario: el retraso con que
 * el cambio en 10 días del caudal más se parece al cambio de Rosario. Después
 * compara, en los mismos días, ajustando con 2005-2021 y midiendo en 2022-2026:
 *   persistencia  Rosario se queda como está
 *   base          los predictores del Modelo Y (a 17 y 21, Rosario y Corrientes de hoy)
 *   + Yacyretá, + Itaipú, + las dos: caudal y cambio en 3 días, cada una con su retraso
 *
 * No toca producción. `npx tsx scripts/prueba-represas.ts`
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { traerSerie, estacionRio, menosDias, type Observacion } from '../src/lib/rio-historia';
import { MODELOS, RETARDOS } from '../src/lib/pronostico-rio';

const CACHE = join(__dirname, '..', '.cache', 'prueba-represas');
const hoy = new Date().toISOString().slice(0, 10);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HORIZONTES = [3, 5, 7, 10, 14, 17, 21];

async function serieINA(nombre: string, id: number): Promise<Map<string, number>> {
  const archivo = join(CACHE, `ina-${nombre}-${hoy}.json`);
  if (!existsSync(archivo)) {
    for (let i = 0; ; i++) {
      try {
        writeFileSync(archivo, JSON.stringify(await traerSerie(id, '2004-01-01', hoy)));
        await esperar(1500);
        break;
      } catch (e) {
        if (i >= 5) throw e;
        await esperar(20_000 * (i + 1));
      }
    }
  }
  return new Map((JSON.parse(readFileSync(archivo, 'utf8')) as Observacion[]).map((o) => [o.dia, o.metros]));
}

/** Vazão defluente diaria de Itaipú, del archivo anual del ONS. */
async function itaipu(): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (let anio = 2004; anio <= Number(hoy.slice(0, 4)); anio++) {
    const archivo = join(CACHE, `ons-itaipu-${anio}${anio === Number(hoy.slice(0, 4)) ? `-${hoy}` : ''}.json`);
    if (!existsSync(archivo)) {
      console.error(`ONS ${anio}…`);
      const r = await fetch(`https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/dados_hidrologicos_di/DADOS_HIDROLOGICOS_RES_${anio}.csv`);
      if (!r.ok) throw new Error(`ONS ${anio}: ${r.status}`);
      const lineas = (await r.text()).split('\n');
      const cab = lineas[0].split(';');
      const iRes = cab.indexOf('id_reservatorio');
      const iDia = cab.indexOf('din_instante');
      const iDef = cab.indexOf('val_vazaodefluente');
      const filas: [string, number][] = [];
      for (const l of lineas) {
        const c = l.split(';');
        if (c[iRes] !== 'PNITAI') continue;
        const v = Number(c[iDef]);
        if (c[iDef] !== '' && Number.isFinite(v)) filas.push([c[iDia].slice(0, 10), v]);
      }
      writeFileSync(archivo, JSON.stringify(filas));
    }
    for (const [d, v] of JSON.parse(readFileSync(archivo, 'utf8')) as [string, number][]) m.set(d, v);
  }
  return m;
}

function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, x) => a + x, 0) / n;
  const my = ys.reduce((a, y) => a + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** El retraso (días) con que el cambio en 10 días de `s` más se parece al de Rosario, en 2005-2021. */
function retraso(s: Map<string, number>, rosario: Map<string, number>): { dias: number; r: number } {
  let mejor = { dias: 0, r: -1 };
  for (let L = 0; L <= 35; L++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let d = '2005-01-01'; d <= '2021-12-31'; d = menosDias(d, -1)) {
      const a = s.get(d);
      const a0 = s.get(menosDias(d, 10));
      const b = rosario.get(menosDias(d, -L));
      const b0 = rosario.get(menosDias(d, 10 - L));
      if (a === undefined || a0 === undefined || b === undefined || b0 === undefined) continue;
      xs.push(a - a0);
      ys.push(b - b0);
    }
    const r = corr(xs, ys);
    if (r > mejor.r) mejor = { dias: L, r };
  }
  return mejor;
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

/** Nivel y cambio en 3 días de una serie en el día que le toca por su retraso (o hoy, si ya no alcanza). */
function par(s: Map<string, number>, d: string, retrasoDias: number, h: number, escala = 1): number[] | null {
  const dia = menosDias(d, Math.max(0, retrasoDias - h));
  const v = s.get(dia);
  const v3 = s.get(menosDias(dia, 3));
  if (v === undefined || v3 === undefined) return null;
  return [v / escala, (v - v3) / escala];
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const rios: Record<string, Map<string, number>> = {};
  for (const k of ['rosario', ...Object.keys(RETARDOS)]) {
    console.error(`río ${k}…`);
    rios[k] = await serieINA(k, estacionRio(k)!.serie);
  }
  console.error('Yacyretá efluente…');
  const yacy = await serieINA('yacyreta-efluente', 937);
  const itai = await itaipu();
  const rosario = rios.rosario;

  const cobertura = (s: Map<string, number>, desde: string, hasta: string) => {
    let n = 0;
    let t = 0;
    for (let d = desde; d <= hasta; d = menosDias(d, -1)) {
      t++;
      if (s.has(d)) n++;
    }
    return `${Math.round((n / t) * 100)} %`;
  };
  console.log(`\nCobertura 2005-2026: Yacyretá ${cobertura(yacy, '2005-01-01', '2026-10-15')}, Itaipú ${cobertura(itai, '2005-01-01', '2026-10-15')}, Corrientes ${cobertura(rios.corrientes, '2005-01-01', '2026-10-15')}`);

  const rY = process.env.LAG_Y ? { dias: Number(process.env.LAG_Y), r: NaN } : retraso(yacy, rosario);
  const rI = process.env.LAG_I ? { dias: Number(process.env.LAG_I), r: NaN } : retraso(itai, rosario);
  const rC = retraso(rios.corrientes, rosario);
  console.log(`Retraso a Rosario (cambio en 10 días, 2005-2021): Corrientes ${rC.dias} d (r ${rC.r.toFixed(2)}), Yacyretá ${rY.dias} d (r ${rY.r.toFixed(2)}), Itaipú ${rI.dias} d (r ${rI.r.toFixed(2)})\n`);

  type Var = 'base' | '+ Yacyretá' | '+ Itaipú' | '+ las dos';
  const VARS: Var[] = ['base', '+ Yacyretá', '+ Itaipú', '+ las dos'];
  const fila = (d: string, h: number, v: Var): number[] | null => {
    const propio = rosario.get(d);
    if (propio === undefined) return null;
    const x = [1, propio];
    const m = MODELOS.find((mm) => mm.horizonte === h);
    // Hasta 14 días, las estaciones del Modelo Y; más allá, Corrientes de hoy.
    const usa = m ? m.usa : ['corrientes'];
    for (const k of usa) {
      const p = par(rios[k], d, RETARDOS[k], h);
      if (!p) return null;
      x.push(...p);
    }
    if (v === '+ Yacyretá' || v === '+ las dos') {
      const p = par(yacy, d, rY.dias, h, 10_000);
      if (!p) return null;
      x.push(...p);
    }
    if (v === '+ Itaipú' || v === '+ las dos') {
      const p = par(itai, d, rI.dias, h, 10_000);
      if (!p) return null;
      x.push(...p);
    }
    return x;
  };

  if (process.env.BARRIDO) {
    // Elige el retraso de cada represa por el error EN EL AJUSTE (2005-2021), a 17 y 21 días.
    for (const [nombre, s] of [['Yacyretá', yacy], ['Itaipú', itai]] as const) {
      const fila2 = (d: string, h: number, L: number): number[] | null => {
        const propio = rosario.get(d);
        const c = par(rios.corrientes, d, RETARDOS.corrientes, h);
        const r = par(s, d, L, h, 10_000);
        return propio === undefined || !c || !r ? null : [1, propio, ...c, ...r];
      };
      for (const h of [14, 17, 21]) {
        const res: string[] = [];
        for (let L = 10; L <= 32; L += 2) {
          const dias: string[] = [];
          for (let d = '2005-01-01'; d <= '2021-12-31'; d = menosDias(d, -1)) {
            if (rosario.get(menosDias(d, -h)) !== undefined && fila2(d, h, L)) dias.push(d);
          }
          const b = ajustar(dias.map((d) => fila2(d, h, L)!), dias.map((d) => rosario.get(menosDias(d, -h))!));
          const e = dias.map((d) => fila2(d, h, L)!.reduce((a, xi, i) => a + xi * b[i], 0) - rosario.get(menosDias(d, -h))!);
          res.push(`${L}:${mae(e).toFixed(4)}`);
        }
        console.log(`${nombre} a ${h} d, mae en el ajuste por retraso → ${res.join(' ')}`);
      }
    }
    return;
  }

  console.log('Error en 2022-2026 (fuera del ajuste), metros. Banda = p90 - p10. Mismos días en cada plazo.\n');
  for (const h of HORIZONTES) {
    const real = (d: string) => rosario.get(menosDias(d, -h));
    const ajuste: string[] = [];
    const prueba: string[] = [];
    for (let d = '2005-01-01'; d <= hoy; d = menosDias(d, -1)) {
      if (real(d) === undefined || VARS.some((v) => fila(d, h, v) === null)) continue;
      (d < '2022-01-01' ? ajuste : prueba).push(d);
    }
    const ep = prueba.map((d) => rosario.get(d)! - real(d)!);
    const lineas = [`  ${'persistencia'.padEnd(13)} mae ${mae(ep).toFixed(3)}  banda ${(percentil(ep, 0.9) - percentil(ep, 0.1)).toFixed(2)}`];
    let maeBase = 0;
    for (const v of VARS) {
      const b = ajustar(ajuste.map((d) => fila(d, h, v)!), ajuste.map((d) => real(d)!));
      const e = prueba.map((d) => fila(d, h, v)!.reduce((a, xi, i) => a + xi * b[i], 0) - real(d)!);
      if (v === 'base') maeBase = mae(e);
      const cambio = v === 'base' ? '' : `  (${Math.round((mae(e) / maeBase - 1) * 100)} %)`;
      lineas.push(`  ${v.padEnd(13)} mae ${mae(e).toFixed(3)}  banda ${(percentil(e, 0.9) - percentil(e, 0.1)).toFixed(2)}${cambio}`);
    }
    console.log(`${h} días (ajuste n ${ajuste.length}, prueba n ${prueba.length})`);
    console.log(lineas.join('\n'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
