/**
 * Ajusta los modelos del escenario probable que usan la lluvia del tramo
 * argentino (`MODELOS_LLUVIA` en src/lib/pronostico-rio.ts) y mide sus bandas.
 * Corre con `npm run ajuste-lluvia-rio` e imprime lo que va en el código:
 * `CLIMA_TRAMO`, `MODELOS_LLUVIA`, `BANDAS_LLUVIA` y `SESGOS_LLUVIA`, más la
 * comparación con el modelo sin lluvia en los mismos días.
 *
 * - Ajuste: 2005-2021, con la lluvia que cayó (ERA5 de Open-Meteo) armada igual
 *   que en vivo: 7 días previos, y para adelante 7 días de lluvia y después la
 *   típica de la época (`lluviaDesdeDias`).
 * - Medición: desde 2024-02-15, con lo que ECMWF pronosticaba ese día (API de
 *   corridas anteriores de Open-Meteo, que guarda desde febrero de 2024 y
 *   hasta 7 días). La pasada, con lo que pronosticó un día antes para cada día:
 *   en vivo ERA5 llega ~5 días tarde y no sirve.
 *
 * Bandas y sesgos salen de esos mismos días: son ~900 por horizonte, ~300 por
 * régimen. El modelo sin lluvia se compara con las suyas, medidas en 2022-2026.
 *
 * Lo bajado queda en `.cache/ajuste-lluvia-rio/`.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { traerSerie, estacionRio, menosDias, type Observacion } from '../src/lib/rio-historia';
import {
  BANDAS,
  BANDAS_LLUVIA,
  MODELOS,
  MODELOS_LLUVIA,
  REGIMENES,
  SERIE_YACYRETA,
  SESGOS,
  SESGOS_LLUVIA,
  predictores,
  regimenCorrientes,
  regresion,
  type ModeloRio,
  type Regimen,
} from '../src/lib/pronostico-rio';
import { DIAS_PRONOSTICO, PUNTOS_TRAMO, lluviaDesdeDias, type LluviaTramo } from '../src/lib/lluvia-tramo';

const CACHE = join(__dirname, '..', '.cache', 'ajuste-lluvia-rio');
const hoy = new Date().toISOString().slice(0, 10);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DESDE_PRUEBA = '2024-02-15';
const HORIZONTES = [7, 10, 14];

async function json<T>(archivo: string, url: string): Promise<T> {
  if (existsSync(archivo)) return JSON.parse(readFileSync(archivo, 'utf8'));
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if (r.ok) {
      const j = await r.json();
      writeFileSync(archivo, JSON.stringify(j));
      await esperar(1000);
      return j as T;
    }
    if (i >= 4) throw new Error(`${r.status} ${url}: ${await r.text()}`);
    await esperar(15_000 * (i + 1));
  }
}

async function serieRio(slug: string, id = estacionRio(slug)!.serie): Promise<Observacion[]> {
  const archivo = join(CACHE, `rio-${slug}-${hoy}.json`);
  if (existsSync(archivo)) return JSON.parse(readFileSync(archivo, 'utf8'));
  for (let i = 0; ; i++) {
    try {
      const s = await traerSerie(id, '2004-11-01', hoy);
      writeFileSync(archivo, JSON.stringify(s));
      await esperar(1500);
      return s;
    } catch (err) {
      if (i >= 5) throw err;
      await esperar(20_000 * (i + 1));
    }
  }
}

/** Promedio de los puntos del tramo, día por día; sólo los días que tienen todos. */
function promedio(puntos: Map<string, number>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const [d] of puntos[0]) {
    const vs = puntos.map((p) => p.get(d));
    if (vs.every((v): v is number => v !== undefined)) m.set(d, vs.reduce((a, v) => a + v, 0) / vs.length);
  }
  return m;
}

/** Lluvia diaria de ERA5 en el tramo. */
async function era5(): Promise<Map<string, number>> {
  const puntos: Map<string, number>[] = [];
  for (const [lon, lat] of PUNTOS_TRAMO) {
    const j = await json<{ daily: { time: string[]; precipitation_sum: (number | null)[] } }>(
      join(CACHE, `era5-${lon}_${lat}-${hoy}.json`),
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=2004-11-01` +
        `&end_date=${menosDias(hoy, 7)}&daily=precipitation_sum&timezone=America%2FArgentina%2FBuenos_Aires`,
    );
    const m = new Map<string, number>();
    j.daily.time.forEach((t, i) => {
      const v = j.daily.precipitation_sum[i];
      if (v !== null) m.set(t, v);
    });
    puntos.push(m);
  }
  return promedio(puntos);
}

/** Lo que ECMWF pronosticó para cada día con 1 a 7 días de anticipación: día → [ant. 1, …, ant. 7]. */
async function ecmwfArchivado(): Promise<Map<string, number[]>> {
  const vars = Array.from({ length: DIAS_PRONOSTICO }, (_, i) => `precipitation_previous_day${i + 1}`);
  const porAnticipacion: Map<string, number>[][] = vars.map(() => []);
  for (const [lon, lat] of PUNTOS_TRAMO) {
    const j = await json<{ hourly: Record<string, (number | null)[]> & { time: string[] } }>(
      join(CACHE, `ecmwf-${lon}_${lat}-${hoy}.json`),
      `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&start_date=2024-02-01&end_date=${menosDias(hoy, 1)}&hourly=${vars.join(',')}` +
        `&models=ecmwf_ifs025&timezone=America%2FArgentina%2FBuenos_Aires`,
    );
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
      porAnticipacion[k].push(new Map([...suma].filter(([, a]) => a.n === 24).map(([d, a]) => [d, a.s])));
    });
  }
  const medias = porAnticipacion.map(promedio);
  const m = new Map<string, number[]>();
  for (const [d] of medias[0]) {
    const vs = medias.map((x) => x.get(d));
    if (vs.every((v): v is number => v !== undefined)) m.set(d, vs);
  }
  return m;
}

/** Lluvia típica por día del año, de ERA5 2005-2021, ±15 días. */
function climatologia(era: Map<string, number>): number[] {
  const doy = (d: string) => Math.floor((Date.parse(d) - Date.parse(`${d.slice(0, 4)}-01-01`)) / 86_400_000);
  const s = new Array(366).fill(0);
  const n = new Array(366).fill(0);
  for (const [d, v] of era) {
    if (d < '2005-01-01' || d > '2021-12-31') continue;
    for (let j = -15; j <= 15; j++) {
      const k = (doy(d) + j + 366) % 366;
      s[k] += v;
      n[k]++;
    }
  }
  return s.map((x, i) => Number((x / n[i]).toFixed(2)));
}

/** La lluvia del tramo como se sabía el día `d`, desde el archivo de ECMWF. */
function lluviaArchivada(ec: Map<string, number[]>, tipica: (d: string) => number): LluviaTramo {
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
        } else s += tipica(dia);
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

const r2 = (x: number) => Number(x.toFixed(2));
const r6 = (x: number) => Number(x.toFixed(6));

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const slugs = ['rosario', ...new Set(MODELOS.flatMap((m) => m.usa))];
  const series: Record<string, Observacion[]> = {};
  for (const k of slugs) {
    console.error(`río ${k}…`);
    series[k] = await serieRio(k);
  }
  const rosario = new Map(series.rosario.map((o) => [o.dia, o.metros]));
  console.error('ERA5 del tramo…');
  const era = await era5();
  console.error('ECMWF archivado…');
  const ec = await ecmwfArchivado();

  const clima = climatologia(era);
  const doy = (d: string) => Math.floor((Date.parse(d) - Date.parse(`${d.slice(0, 4)}-01-01`)) / 86_400_000);
  const tipica = (d: string) => clima[doy(d)];
  const lluviaAjuste = lluviaDesdeDias(era, tipica);
  const lluviaPrueba = lluviaArchivada(ec, tipica);

  const modelos: ModeloRio[] = [];
  const bandas: Record<number, Record<Regimen, [number, number]>> = {};
  const sesgos: Record<number, Record<Regimen, number>> = {};
  const tabla: string[] = [];

  for (const h of HORIZONTES) {
    const sin = MODELOS.find((m) => m.horizonte === h)!;
    const molde: ModeloRio = { horizonte: h, usa: sin.usa, coef: [], mae: 0, lluvia: true };
    const real = (d: string) => rosario.get(menosDias(d, -h));

    const X: number[][] = [];
    const y: number[] = [];
    for (let d = '2005-01-01'; d <= '2021-12-31'; d = menosDias(d, -1)) {
      const r = real(d);
      const x = predictores(series, d, molde, lluviaAjuste);
      if (r === undefined || x === null) continue;
      X.push(x);
      y.push(r);
    }
    const modelo: ModeloRio = { ...molde, coef: ajustar(X, y).map(r6) };

    // Los mismos días para los dos modelos: los que tienen todo.
    const dias: { d: string; real: number; con: number; sin: number; regimen: Regimen }[] = [];
    for (let d = DESDE_PRUEBA; d <= hoy; d = menosDias(d, -1)) {
      const r = real(d);
      const con = regresion(series, d, modelo, lluviaPrueba);
      const s = regresion(series, d, sin);
      const regimen = regimenCorrientes(series.corrientes, d);
      if (r === undefined || con === null || s === null || !regimen) continue;
      dias.push({ d, real: r, con, sin: s, regimen });
    }
    const errores = dias.map((x) => x.con - x.real);
    modelo.mae = Number((errores.reduce((a, e) => a + Math.abs(e), 0) / errores.length).toFixed(3));
    modelos.push(modelo);

    bandas[h] = {} as Record<Regimen, [number, number]>;
    sesgos[h] = {} as Record<Regimen, number>;
    for (const rg of REGIMENES) {
      const xs = dias.filter((x) => x.regimen === rg).map((x) => x.con - x.real);
      bandas[h][rg] = [r2(percentil(xs, 0.1)), r2(percentil(xs, 0.9))];
      sesgos[h][rg] = r2(percentil(xs, 0.5));
    }

    // Lo que ve la gente: el número corregido por el sesgo y la banda alrededor.
    const medir = (crudo: (x: (typeof dias)[number]) => number, B: typeof BANDAS, S: typeof SESGOS) => {
      let abs = 0;
      let dentro = 0;
      let ancho = 0;
      for (const x of dias) {
        const c = crudo(x);
        const centro = c - S[h][x.regimen];
        const [p10, p90] = B[h][x.regimen];
        abs += Math.abs(centro - x.real);
        if (x.real >= c - p90 && x.real <= c - p10) dentro++;
        ancho += p90 - p10;
      }
      return { mae: abs / dias.length, cubre: dentro / dias.length, ancho: ancho / dias.length };
    };
    const antes = medir((x) => x.sin, BANDAS, SESGOS);
    const despues = medir((x) => x.con, bandas, sesgos);
    tabla.push(
      `| ${h} | ${dias.length} | ${antes.mae.toFixed(3)} | ${despues.mae.toFixed(3)} | ${Math.round((despues.mae / antes.mae - 1) * 100)} % ` +
        `| ${Math.round(antes.ancho * 100)} cm | ${Math.round(despues.ancho * 100)} cm | ${Math.round(antes.cubre * 100)} % | ${Math.round(despues.cubre * 100)} % |`,
    );
  }

  // Con Yacyretá: 14 días (contra el de lluvia que está en producción) y 17
  // (que no existía: contra la persistencia, que el río se quede como está).
  console.error('Yacyretá efluente…');
  series.yacyreta = await serieRio('yacyreta', SERIE_YACYRETA);
  const modelosR: ModeloRio[] = [];
  const bandasR: Record<number, Record<Regimen, [number, number]>> = {};
  const sesgosR: Record<number, Record<Regimen, number>> = {};
  const tablaR: string[] = [];
  for (const h of [14, 17]) {
    const sin = MODELOS.find((m) => m.horizonte === h);
    const molde: ModeloRio = { horizonte: h, usa: sin?.usa ?? ['corrientes'], coef: [], mae: 0, lluvia: true, represa: true };
    const real = (d: string) => rosario.get(menosDias(d, -h));
    const X: number[][] = [];
    const y: number[] = [];
    for (let d = '2005-01-01'; d <= '2021-12-31'; d = menosDias(d, -1)) {
      const r = real(d);
      const x = predictores(series, d, molde, lluviaAjuste);
      if (r === undefined || x === null) continue;
      X.push(x);
      y.push(r);
    }
    const modelo: ModeloRio = { ...molde, coef: ajustar(X, y).map(r6) };
    const enProduccion = MODELOS_LLUVIA.find((m) => m.horizonte === h);
    const dias: { real: number; con: number; antes: number | null; persiste: number; regimen: Regimen }[] = [];
    for (let d = DESDE_PRUEBA; d <= hoy; d = menosDias(d, -1)) {
      const r = real(d);
      const con = regresion(series, d, modelo, lluviaPrueba);
      const antes = enProduccion ? regresion(series, d, enProduccion, lluviaPrueba) : null;
      const regimen = regimenCorrientes(series.corrientes, d);
      const persiste = rosario.get(d);
      if (r === undefined || con === null || (enProduccion && antes === null) || !regimen || persiste === undefined) continue;
      dias.push({ real: r, con, antes, persiste, regimen });
    }
    const errores = dias.map((x) => x.con - x.real);
    modelo.mae = Number((errores.reduce((a, e) => a + Math.abs(e), 0) / errores.length).toFixed(3));
    modelosR.push(modelo);
    bandasR[h] = {} as Record<Regimen, [number, number]>;
    sesgosR[h] = {} as Record<Regimen, number>;
    for (const rg of REGIMENES) {
      const xs = dias.filter((x) => x.regimen === rg).map((x) => x.con - x.real);
      bandasR[h][rg] = [r2(percentil(xs, 0.1)), r2(percentil(xs, 0.9))];
      sesgosR[h][rg] = r2(percentil(xs, 0.5));
    }
    const medir = (crudo: (x: (typeof dias)[number]) => number, B: typeof BANDAS, S: typeof SESGOS) => {
      let abs = 0;
      let dentro = 0;
      let ancho = 0;
      for (const x of dias) {
        const c = crudo(x);
        const [p10, p90] = B[h][x.regimen];
        abs += Math.abs(c - S[h][x.regimen] - x.real);
        if (x.real >= c - p90 && x.real <= c - p10) dentro++;
        ancho += p90 - p10;
      }
      return { mae: abs / dias.length, cubre: dentro / dias.length, ancho: ancho / dias.length };
    };
    const despues = medir((x) => x.con, bandasR, sesgosR);
    if (enProduccion) {
      const antes = medir((x) => x.antes!, BANDAS_LLUVIA, SESGOS_LLUVIA);
      tablaR.push(
        `| ${h} (antes: con lluvia) | ${dias.length} | ${antes.mae.toFixed(3)} | ${despues.mae.toFixed(3)} | ${Math.round((despues.mae / antes.mae - 1) * 100)} % ` +
          `| ${Math.round(antes.ancho * 100)} cm | ${Math.round(despues.ancho * 100)} cm | ${Math.round(antes.cubre * 100)} % | ${Math.round(despues.cubre * 100)} % |`,
      );
    } else {
      const persiste = dias.reduce((a, x) => a + Math.abs(x.persiste - x.real), 0) / dias.length;
      tablaR.push(
        `| ${h} (antes: no había; contra persistencia) | ${dias.length} | ${persiste.toFixed(3)} | ${despues.mae.toFixed(3)} | ${Math.round((despues.mae / persiste - 1) * 100)} % ` +
          `| — | ${Math.round(despues.ancho * 100)} cm | — | ${Math.round(despues.cubre * 100)} % |`,
      );
    }
  }

  console.log(`\nexport const CLIMA_TRAMO: number[] = ${JSON.stringify(clima)};\n`);
  console.log(`export const MODELOS_LLUVIA: ModeloRio[] = ${JSON.stringify(modelos, null, 2)};\n`);
  console.log(`export const BANDAS_LLUVIA = ${JSON.stringify(bandas)};\n`);
  console.log(`export const SESGOS_LLUVIA = ${JSON.stringify(sesgos)};\n`);
  console.log(`Desde ${DESDE_PRUEBA}, mismos días; número corregido por el sesgo, como en la página.\n`);
  console.log('| Días | n | Error antes | Error después | Cambio | Banda antes | Banda después | Cubre antes | Cubre después |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  console.log(tabla.join('\n'));
  console.log(`\nexport const MODELOS_REPRESA: ModeloRio[] = ${JSON.stringify(modelosR, null, 2)};\n`);
  console.log(`export const BANDAS_REPRESA = ${JSON.stringify(bandasR)};\n`);
  console.log(`export const SESGOS_REPRESA = ${JSON.stringify(sesgosR)};\n`);
  console.log('Con Yacyretá, mismos días:\n');
  console.log('| Días | n | Error antes | Error después | Cambio | Banda antes | Banda después | Cubre antes | Cubre después |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  console.log(tablaR.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
