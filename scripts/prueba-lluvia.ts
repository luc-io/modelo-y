/**
 * ¿Sumar lluvia y humedad del suelo mejora el escenario probable de Rosario?
 * Prueba con "lluvia perfecta": en vez de un pronóstico se usa la lluvia que
 * de verdad cayó (ERA5) y el suelo de ERA5-Land, promediados por subcuenca.
 * Si ni así baja el error, un pronóstico de lluvia real tampoco va a ayudar.
 *
 * Tres variantes, todas ajustadas por mínimos cuadrados con 2005-2021 y
 * medidas contra 2022-2026 (el mismo corte que `margen-rio`):
 *   base       los predictores de hoy (`regresion` en pronostico-rio.ts)
 *   observado  + lluvia de los 7 días previos y suelo del día, por subcuenca:
 *              se podría usar hoy, sin pronóstico
 *   oráculo    + la lluvia que cayó entre mañana y el día pronosticado, y esa
 *              lluvia por el suelo: el techo de lo que daría un pronóstico
 *
 * No toca producción. `npx tsx scripts/prueba-lluvia.ts`
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { traerSerie, estacionRio, menosDias, type Observacion } from '../src/lib/rio-historia';
import { MODELOS, RETARDOS, regimenCorrientes, type ModeloRio } from '../src/lib/pronostico-rio';

const CACHE = join(__dirname, '..', '.cache', 'prueba-lluvia');
const hoy = new Date().toISOString().slice(0, 10);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Puntos (lon, lat) que se promedian en cada subcuenca. */
const SUBCUENCAS: Record<string, [number, number][]> = {
  // Afluentes del tramo Corrientes-Rosario: Salado santafesino, norte de
  // Santa Fe y sureste del Chaco por la derecha; Corrientes y norte de Entre
  // Ríos (Corriente, Feliciano, Guayquiraró) por la izquierda.
  tramo: [[-61.0, -31.0], [-61.5, -29.5], [-60.0, -28.5], [-58.8, -29.5], [-59.3, -31.0], [-58.0, -28.5]],
  paraguay: [[-58.5, -24.5], [-59.5, -26.0], [-57.0, -23.0], [-60.5, -24.0]],
  // Alto Paraná no regulado, Iguazú y Misiones.
  alto: [[-53.0, -25.5], [-54.0, -24.5], [-51.5, -25.8], [-55.0, -27.0]],
};

type Clima = Map<string, { lluvia: number; suelo: number }>;

async function serieRio(slug: string): Promise<Observacion[]> {
  const archivo = join(CACHE, `rio-${slug}-${hoy}.json`);
  if (existsSync(archivo)) return JSON.parse(readFileSync(archivo, 'utf8'));
  const e = estacionRio(slug)!;
  for (let i = 0; ; i++) {
    try {
      const s = await traerSerie(e.serie, '2004-11-01', hoy);
      writeFileSync(archivo, JSON.stringify(s));
      return s;
    } catch (err) {
      if (i >= 5) throw err;
      await esperar(20_000 * (i + 1));
    }
  }
}

/** Lluvia diaria y suelo 7-28 cm de un punto, de ERA5 / ERA5-Land vía Open-Meteo. */
async function puntoClima([lon, lat]: [number, number]): Promise<Clima> {
  const archivo = join(CACHE, `era5-${lon}_${lat}.json`);
  let json: { daily: { time: string[]; precipitation_sum: (number | null)[]; soil_moisture_7_to_28cm_mean: (number | null)[] } };
  if (existsSync(archivo)) json = JSON.parse(readFileSync(archivo, 'utf8'));
  else {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=2004-11-01&end_date=${menosDias(hoy, 7)}` +
      `&daily=precipitation_sum,soil_moisture_7_to_28cm_mean&timezone=America/Argentina/Buenos_Aires`;
    for (let i = 0; ; i++) {
      const r = await fetch(url);
      if (r.ok) {
        json = await r.json();
        break;
      }
      if (i >= 4) throw new Error(`open-meteo ${r.status} en ${lon},${lat}`);
      await esperar(15_000 * (i + 1));
    }
    writeFileSync(archivo, JSON.stringify(json));
  }
  const m: Clima = new Map();
  json.daily.time.forEach((t, i) => {
    const ll = json.daily.precipitation_sum[i];
    const su = json.daily.soil_moisture_7_to_28cm_mean[i];
    if (ll !== null && su !== null) m.set(t, { lluvia: ll, suelo: su });
  });
  return m;
}

/** Promedio de los puntos de la subcuenca, día por día. */
function promedio(puntos: Clima[]): Clima {
  const m: Clima = new Map();
  for (const [t] of puntos[0]) {
    const vs = puntos.map((p) => p.get(t));
    if (vs.some((v) => !v)) continue;
    m.set(t, {
      lluvia: vs.reduce((a, v) => a + v!.lluvia, 0) / vs.length,
      suelo: vs.reduce((a, v) => a + v!.suelo, 0) / vs.length,
    });
  }
  return m;
}

function suma(c: Clima, desde: string, hasta: string): number | null {
  let s = 0;
  for (let d = desde; d <= hasta; d = menosDias(d, -1)) {
    const v = c.get(d);
    if (!v) return null;
    s += v.lluvia;
  }
  return s;
}

const enDia = (s: Map<string, number>, d: string) => s.get(d) ?? null;

type Variante = 'base' | 'observado' | 'oráculo' | 'oráculo-tramo';
const VARIANTES: Variante[] = ['base', 'observado', 'oráculo'];

/** La fila de predictores para pronosticar `h` días desde `d`, o null si falta algo. */
function fila(
  rios: Record<string, Map<string, number>>,
  clima: Record<string, Clima>,
  d: string,
  m: ModeloRio,
  v: Variante,
  /** De dónde sale la lluvia futura del tramo en 'oráculo-tramo'. Por defecto, la que cayó (ERA5). */
  futuroTramo?: (d: string, h: number) => number | null,
): number[] | null {
  const propio = enDia(rios.rosario, d);
  if (propio === null) return null;
  const x = [1, propio];
  for (const k of m.usa) {
    const dia = menosDias(d, RETARDOS[k] - m.horizonte);
    const nivel = enDia(rios[k], dia);
    const antes = enDia(rios[k], menosDias(dia, 3));
    if (nivel === null || antes === null) return null;
    x.push(nivel, nivel - antes);
  }
  if (v === 'base') return x;
  for (const [nombre, c] of Object.entries(clima)) {
    const pasada = suma(c, menosDias(d, 6), d);
    const suelo = c.get(d)?.suelo ?? null;
    if (pasada === null || suelo === null) return null;
    x.push(pasada / 100, suelo * 10);
    if (v === 'oráculo' || (v === 'oráculo-tramo' && nombre === 'tramo')) {
      const futura =
        v === 'oráculo-tramo' && futuroTramo
          ? futuroTramo(d, m.horizonte)
          : suma(c, menosDias(d, -1), menosDias(d, -m.horizonte));
      if (futura === null) return null;
      x.push(futura / 100, (futura / 100) * suelo * 10);
    }
  }
  return x;
}

/** Mínimos cuadrados por ecuaciones normales, con un ridge mínimo para que no se trabe. */
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

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const slugs = ['rosario', ...new Set(MODELOS.flatMap((m) => m.usa))];
  const rios: Record<string, Map<string, number>> = {};
  for (const k of slugs) {
    console.error(`río ${k}…`);
    rios[k] = new Map((await serieRio(k)).map((o) => [o.dia, o.metros]));
    await esperar(1500);
  }
  const corrientes = [...rios.corrientes].map(([dia, metros]) => ({ dia, metros }) as Observacion);
  const clima: Record<string, Clima> = {};
  for (const [nombre, pts] of Object.entries(SUBCUENCAS)) {
    console.error(`ERA5 ${nombre}…`);
    const series: Clima[] = [];
    for (const p of pts) {
      series.push(await puntoClima(p));
      await esperar(1000);
    }
    clima[nombre] = promedio(series);
  }
  // SOLO=tramo,alto deja sólo esas subcuencas, para ver de cuál sale la mejora.
  if (process.env.SOLO) for (const k of Object.keys(clima)) if (!process.env.SOLO.split(',').includes(k)) delete clima[k];

  if (process.env.MODO === 'pronostico') return conPronostico(rios, clima);
  if (process.env.MODO === 'terminos') return compararTerminos(rios, clima);

  const resultado: Record<string, unknown> = {};
  console.log('\nError en 2022-2026 (fuera del ajuste), metros. «sube»: Corrientes subió fuerte en los 10 días previos.\n');
  for (const m of MODELOS) {
    // Los mismos días para las tres variantes: los que tienen todos los datos.
    const dias = { ajuste: [] as string[], prueba: [] as string[] };
    for (let d = '2005-01-01'; d <= hoy; d = menosDias(d, -1)) {
      const real = enDia(rios.rosario, menosDias(d, -m.horizonte));
      if (real === null) continue;
      if (VARIANTES.some((v) => fila(rios, clima, d, m, v) === null)) continue;
      (d < '2022-01-01' ? dias.ajuste : dias.prueba).push(d);
    }
    const lineas: string[] = [];
    const porVariante: Record<string, unknown> = {};
    for (const v of VARIANTES) {
      const X = dias.ajuste.map((d) => fila(rios, clima, d, m, v)!);
      const y = dias.ajuste.map((d) => enDia(rios.rosario, menosDias(d, -m.horizonte))!);
      const b = ajustar(X, y);
      const err: number[] = [];
      const errSube: number[] = [];
      for (const d of dias.prueba) {
        const x = fila(rios, clima, d, m, v)!;
        const e = x.reduce((a, xi, i) => a + xi * b[i], 0) - enDia(rios.rosario, menosDias(d, -m.horizonte))!;
        err.push(e);
        if (regimenCorrientes(corrientes, d) === 'sube') errSube.push(e);
      }
      const ancho = percentil(err, 0.9) - percentil(err, 0.1);
      porVariante[v] = { mae: mae(err), ancho, maeSube: errSube.length ? mae(errSube) : null, sesgoSube: errSube.length ? errSube.reduce((a, e) => a + e, 0) / errSube.length : null };
      lineas.push(
        `  ${v.padEnd(10)} mae ${mae(err).toFixed(3)}  banda p10-p90 ${ancho.toFixed(2)}  |  sube: mae ${errSube.length ? mae(errSube).toFixed(3) : '-'}  sesgo ${errSube.length ? (errSube.reduce((a, e) => a + e, 0) / errSube.length).toFixed(3) : '-'} (n ${errSube.length})`,
      );
    }
    console.log(`${m.horizonte} días (ajuste n ${dias.ajuste.length}, prueba n ${dias.prueba.length}; mae guardado ${m.mae.toFixed(3)})`);
    console.log(lineas.join('\n'));
    resultado[m.horizonte] = porVariante;
  }
  writeFileSync(join(CACHE, `resultado-${hoy}.json`), JSON.stringify(resultado, null, 2));
}

/**
 * Lo que pronosticó un modelo para cada día del tramo, por anticipación: el
 * día `t` → [lluvia pronosticada 1 día antes, 2 días antes, … 7 días antes],
 * promedio de los puntos del tramo. Sale de la API de corridas anteriores de
 * Open-Meteo, que guarda desde febrero de 2024 y hasta 7 días de anticipación.
 */
async function pronosticosTramo(modelo: string): Promise<Map<string, number[]>> {
  const porPunto: Map<string, number[]>[] = [];
  const vars = Array.from({ length: 7 }, (_, i) => `precipitation_previous_day${i + 1}`);
  for (const [lon, lat] of SUBCUENCAS.tramo) {
    const archivo = join(CACHE, `prev-${modelo}-${lon}_${lat}-${hoy}.json`);
    let json: { hourly: Record<string, (number | null)[]> & { time: string[] } };
    if (existsSync(archivo)) json = JSON.parse(readFileSync(archivo, 'utf8'));
    else {
      const url =
        `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&start_date=2024-02-01&end_date=${menosDias(hoy, 1)}&hourly=${vars.join(',')}` +
        `&models=${modelo}&timezone=America/Argentina/Buenos_Aires`;
      for (let i = 0; ; i++) {
        const r = await fetch(url);
        if (r.ok) {
          json = await r.json();
          break;
        }
        if (i >= 4) throw new Error(`previous-runs ${r.status} en ${lon},${lat}: ${await r.text()}`);
        await esperar(15_000 * (i + 1));
      }
      writeFileSync(archivo, JSON.stringify(json));
      await esperar(1000);
    }
    // De horas a días: sólo los días con las 24 horas de cada anticipación.
    const dias = new Map<string, { suma: number[]; n: number[] }>();
    json.hourly.time.forEach((t, i) => {
      const dia = t.slice(0, 10);
      const a = dias.get(dia) ?? { suma: new Array(7).fill(0), n: new Array(7).fill(0) };
      vars.forEach((v, k) => {
        const x = json.hourly[v][i];
        if (x !== null) {
          a.suma[k] += x;
          a.n[k]++;
        }
      });
      dias.set(dia, a);
    });
    const m = new Map<string, number[]>();
    for (const [dia, a] of dias) if (a.n.every((n) => n === 24)) m.set(dia, a.suma);
    porPunto.push(m);
  }
  const m = new Map<string, number[]>();
  for (const [dia] of porPunto[0]) {
    const vs = porPunto.map((p) => p.get(dia));
    if (vs.some((v) => !v)) continue;
    m.set(dia, Array.from({ length: 7 }, (_, k) => vs.reduce((a, v) => a + v![k], 0) / vs.length));
  }
  return m;
}

/** Lluvia típica del tramo para cada día del año: media de 2005-2021, ±15 días. */
function climatologia(c: Clima): (dia: string) => number {
  const doy = (d: string) => Math.floor((Date.parse(d) - Date.parse(d.slice(0, 4) + '-01-01')) / 86_400_000);
  const suma = new Array(366).fill(0);
  const n = new Array(366).fill(0);
  for (const [d, v] of c) {
    if (d < '2005-01-01' || d > '2021-12-31') continue;
    const k = doy(d);
    for (let j = -15; j <= 15; j++) {
      suma[(k + j + 366) % 366] += v.lluvia;
      n[(k + j + 366) % 366]++;
    }
  }
  return (d) => suma[doy(d)] / n[doy(d)];
}

/**
 * Lo mismo que el oráculo del tramo, pero con lo que se sabía el día del
 * pronóstico: la lluvia pronosticada para los días 1 a 7 y la típica de la
 * época para el resto. Se compara en los mismos días contra la base, lo
 * observado, el oráculo y la sola climatología.
 */
async function conPronostico(rios: Record<string, Map<string, number>>, clima: Record<string, Clima>) {
  const clim = climatologia(clima.tramo);
  const pron: Record<string, Map<string, number[]>> = {};
  for (const modelo of ['ecmwf_ifs025', 'gfs_seamless']) {
    console.error(`pronósticos ${modelo}…`);
    pron[modelo] = await pronosticosTramo(modelo);
  }
  const conModelo = (p: Map<string, number[]>) => (d: string, h: number) => {
    let s = 0;
    for (let k = 1; k <= h; k++) {
      const dia = menosDias(d, -k);
      if (k <= 7) {
        const v = p.get(dia)?.[k - 1];
        if (v === undefined) return null;
        s += v;
      } else s += clim(dia);
    }
    return s;
  };
  const fuentes: Record<string, (d: string, h: number) => number | null> = {
    'oráculo (ERA5)': (d, h) => suma(clima.tramo, menosDias(d, -1), menosDias(d, -h)),
    'pronóstico ECMWF': conModelo(pron.ecmwf_ifs025),
    'pronóstico GFS': conModelo(pron.gfs_seamless),
    'sólo climatología': (d, h) => {
      let s = 0;
      for (let k = 1; k <= h; k++) s += clim(menosDias(d, -k));
      return s;
    },
  };

  console.log('\nCon pronóstico real de lluvia en el tramo, desde febrero de 2024. Error en metros.\n');
  for (const m of MODELOS) {
    const ajuste: string[] = [];
    const prueba: string[] = [];
    for (let d = '2005-01-01'; d <= hoy; d = menosDias(d, -1)) {
      const real = enDia(rios.rosario, menosDias(d, -m.horizonte));
      if (real === null) continue;
      if (d < '2022-01-01') {
        if ((['base', 'observado', 'oráculo-tramo'] as Variante[]).every((v) => fila(rios, clima, d, m, v) !== null)) ajuste.push(d);
      } else if (d >= '2024-02-15') {
        const todas = [fila(rios, clima, d, m, 'base'), fila(rios, clima, d, m, 'observado'), ...Object.values(fuentes).map((f) => fila(rios, clima, d, m, 'oráculo-tramo', f))];
        if (todas.every((x) => x !== null)) prueba.push(d);
      }
    }
    const real = (d: string) => enDia(rios.rosario, menosDias(d, -m.horizonte))!;
    const coef = (v: Variante) => ajustar(ajuste.map((d) => fila(rios, clima, d, m, v)!), ajuste.map(real));
    const medir = (b: number[], v: Variante, f?: (d: string, h: number) => number | null) => {
      const err = prueba.map((d) => fila(rios, clima, d, m, v, f)!.reduce((a, xi, i) => a + xi * b[i], 0) - real(d));
      return `mae ${mae(err).toFixed(3)}  banda p10-p90 ${(percentil(err, 0.9) - percentil(err, 0.1)).toFixed(2)}`;
    };
    const bTramo = coef('oráculo-tramo');
    console.log(`${m.horizonte} días (prueba n ${prueba.length})`);
    console.log(`  ${'base'.padEnd(18)} ${medir(coef('base'), 'base')}`);
    console.log(`  ${'observado'.padEnd(18)} ${medir(coef('observado'), 'observado')}`);
    for (const [nombre, f] of Object.entries(fuentes)) console.log(`  ${nombre.padEnd(18)} ${medir(bTramo, 'oráculo-tramo', f)}`);
  }
}


/**
 * Variantes para producción: qué hacer con lo "observado", que ERA5 publica
 * con ~5 días de atraso. `obs`: 'no' (sólo pronóstico), 'rezagado' (lluvia de
 * 13 a 7 días antes y suelo de 7 días antes: ERA5 ya lo tiene) o 'actual'
 * (lo de la prueba, imposible en vivo). Lluvia futura sólo sobre el tramo.
 */
type Config = { obs: 'no' | 'rezagado' | 'actual'; interaccion: boolean; pasadaTramo?: boolean };
function filaCfg(
  rios: Record<string, Map<string, number>>,
  clima: Record<string, Clima>,
  d: string,
  m: ModeloRio,
  cfg: Config,
  futuro: (d: string, h: number) => number | null,
  /** Lluvia del tramo en los 7 días hasta `d`, para `pasadaTramo`. Por defecto, ERA5. */
  pasada?: (d: string) => number | null,
): number[] | null {
  const x = fila(rios, clima, d, m, 'base');
  if (!x) return null;
  const rezago = cfg.obs === 'rezagado' ? 7 : 0;
  if (cfg.obs !== 'no') {
    for (const c of Object.values(clima)) {
      const ref = menosDias(d, rezago);
      const pasada = suma(c, menosDias(ref, 6), ref);
      const suelo = c.get(ref)?.suelo ?? null;
      if (pasada === null || suelo === null) return null;
      x.push(pasada / 100, suelo * 10);
    }
  }
  if (cfg.pasadaTramo) {
    const p = pasada ? pasada(d) : suma(clima.tramo, menosDias(d, 6), d);
    if (p === null) return null;
    x.push(p / 100);
  }
  const futura = futuro(d, m.horizonte);
  if (futura === null) return null;
  x.push(futura / 100);
  if (cfg.interaccion) {
    const suelo = clima.tramo.get(menosDias(d, cfg.obs === 'actual' ? 0 : 7))?.suelo ?? null;
    if (suelo === null) return null;
    x.push((futura / 100) * suelo * 10);
  }
  return x;
}

async function compararTerminos(rios: Record<string, Map<string, number>>, clima: Record<string, Clima>) {
  const clim = climatologia(clima.tramo);
  const ecmwf = await pronosticosTramo('ecmwf_ifs025');
  const era = (d: string, h: number) => suma(clima.tramo, menosDias(d, -1), menosDias(d, -h));
  const pron = (d: string, h: number) => {
    let s = 0;
    for (let k = 1; k <= h; k++) {
      const dia = menosDias(d, -k);
      if (k <= 7) {
        const v = ecmwf.get(dia)?.[k - 1];
        if (v === undefined) return null;
        s += v;
      } else s += clim(dia);
    }
    return s;
  };
  // Lo que ECMWF pronosticó un día antes para cada uno de los últimos 7 días:
  // en vivo se tiene al día, a diferencia de ERA5.
  const pasadaEcmwf = (d: string) => {
    let s = 0;
    for (let k = 0; k < 7; k++) {
      const v = ecmwf.get(menosDias(d, k))?.[0];
      if (v === undefined) return null;
      s += v;
    }
    return s;
  };
  const configs: Record<string, Config> = {
    'A sólo pronóstico': { obs: 'no', interaccion: false },
    'A + suelo rezagado': { obs: 'no', interaccion: true },
    'B rezagado': { obs: 'rezagado', interaccion: true },
    'D + pasada ECMWF': { obs: 'no', interaccion: true, pasadaTramo: true },
    'D sin suelo': { obs: 'no', interaccion: false, pasadaTramo: true },
    'C actual (techo)': { obs: 'actual', interaccion: true },
  };
  console.log('\nTérminos observados. Ajuste 2005-2021 con ERA5; prueba con ECMWF desde 2024-02-15, mismos días.\n');
  for (const m of MODELOS.filter((x) => x.horizonte >= 7)) {
    const ajuste: string[] = [];
    const prueba: string[] = [];
    const real = (d: string) => enDia(rios.rosario, menosDias(d, -m.horizonte));
    for (let d = '2005-01-01'; d <= hoy; d = menosDias(d, -1)) {
      if (real(d) === null) continue;
      const cfgs = Object.values(configs);
      if (d < '2022-01-01') {
        if (cfgs.every((c) => filaCfg(rios, clima, d, m, c, era) !== null)) ajuste.push(d);
      } else if (d >= '2024-02-15' && cfgs.every((c) => filaCfg(rios, clima, d, m, c, pron, pasadaEcmwf) !== null)) prueba.push(d);
    }
    const base = ajustar(ajuste.map((d) => fila(rios, clima, d, m, 'base')!), ajuste.map((d) => real(d)!));
    const eb = prueba.map((d) => fila(rios, clima, d, m, 'base')!.reduce((a, xi, i) => a + xi * base[i], 0) - real(d)!);
    console.log(`${m.horizonte} días (prueba n ${prueba.length})`);
    console.log(`  ${'base'.padEnd(20)} mae ${mae(eb).toFixed(3)}  banda ${(percentil(eb, 0.9) - percentil(eb, 0.1)).toFixed(2)}`);
    for (const [nombre, c] of Object.entries(configs)) {
      const b = ajustar(ajuste.map((d) => filaCfg(rios, clima, d, m, c, era)!), ajuste.map((d) => real(d)!));
      const e = prueba.map((d) => filaCfg(rios, clima, d, m, c, pron, pasadaEcmwf)!.reduce((a, xi, i) => a + xi * b[i], 0) - real(d)!);
      console.log(`  ${nombre.padEnd(20)} mae ${mae(e).toFixed(3)}  banda ${(percentil(e, 0.9) - percentil(e, 0.1)).toFixed(2)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
