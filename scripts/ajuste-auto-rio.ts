/**
 * Ajusta y mide la variante del Modelo Y que arranca Rosario desde el
 * hidrómetro automático, a 3 y 5 días. Imprime los bloques `auto` para pegar
 * en src/lib/pronostico-rio.ts.
 *
 * El cuadro de Prefectura que usa el modelo es la lectura de la mañana
 * anterior; el automático ya tiene la de hoy. El predictor nuevo es cuánto
 * cambió el automático entre las 8 de ayer y las 8 de hoy.
 *
 * - Ajuste 2005-2021. El automático empieza en 2020, así que ahí el predictor
 *   es el mismo cambio leído en la serie de Prefectura un día después (la
 *   lectura fechada D+1 es la de la mañana de D): contra el automático,
 *   correlación 0,76 y 3,6 cm de diferencia media.
 * - Bandas, sesgos y error, 2022-2026 con el automático de verdad.
 *
 * Probado y descartado el 10/11/2026: lo mismo en Paraná y La Paz (0 a +2 %
 * con sus automáticos) y a 7 días o más (−2 % a 7, 0 desde 10).
 *
 * Lee `.cache/ajuste-lluvia-rio/` (correr antes `npm run ajuste-lluvia-rio`)
 * y baja el automático a `.cache/automaticos/` la primera vez (unos minutos:
 * el INA corta si se le pide rápido). Corre con `npm run ajuste-auto`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { menosDias, type Observacion } from '../src/lib/rio-historia';
import { MODELOS, MODELOS_MEDIO, REGIMENES, SUBE_SEMANA, cambioAutomatico, diasSubiendo, predictores, regimenCorrientes, type Regimen } from '../src/lib/pronostico-rio';
import { fecha, rosario, series } from './datos-ajuste';

/** Hidrómetro automático de Rosario (red SAT del INA), altura cada hora. */
const SERIE_AUTOMATICO = 29435;

/**
 * El automático a un valor por día: la lectura más cercana a las 8 de la
 * mañana de Argentina (11 UTC), a no más de dos horas. Es la hora de la
 * escala de Prefectura.
 */
function automaticoDiario(horas: { t: string; metros: number }[]): Observacion[] {
  const mejor = new Map<string, { lejos: number; metros: number }>();
  for (const h of horas) {
    const t = Date.parse(h.t);
    const dia = new Date(t - 3 * 3_600_000).toISOString().slice(0, 10);
    const lejos = Math.abs(t - Date.parse(`${dia}T11:00:00.000Z`));
    if (lejos > 2 * 3_600_000) continue;
    const ya = mejor.get(dia);
    if (!ya || lejos < ya.lejos) mejor.set(dia, { lejos, metros: h.metros });
  }
  return [...mejor].map(([dia, v]) => ({ dia, metros: v.metros })).sort((a, b) => a.dia.localeCompare(b.dia));
}

const PRUEBA = '2022-01-01';
const ARCHIVO = '.cache/automaticos/rosario-diario.json';
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bajar(): Promise<Observacion[]> {
  if (existsSync(ARCHIVO)) return JSON.parse(readFileSync(ARCHIVO, 'utf8'));
  const horas: { t: string; metros: number }[] = [];
  for (let a = 2020; a <= Number(fecha.slice(0, 4)); a++) {
    for (const [m0, m1] of [['01-01', '04-01'], ['04-01', '07-01'], ['07-01', '10-01'], ['10-01', '12-31T23:59']]) {
      const url = `https://alerta.ina.gob.ar/a5/obs/puntual/series/${SERIE_AUTOMATICO}?timestart=${a}-${m0}&timeend=${a}-${m1}`;
      for (let intento = 0; intento < 5; intento++) {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; modelo-y/1.0)' } });
        if (res.status === 429) {
          await esperar(15_000);
          continue;
        }
        if (!res.ok) break;
        const d = (await res.json()) as { observaciones?: { timestart?: string; valor?: number | string | null }[] };
        for (const o of d.observaciones ?? []) {
          const metros = Number(o.valor);
          if (o.valor !== null && Number.isFinite(metros) && !Number.isNaN(Date.parse(String(o.timestart)))) horas.push({ t: String(o.timestart), metros });
        }
        break;
      }
      console.log(`  automático ${a}-${m0}: ${horas.length} horas`);
      await esperar(2500);
    }
  }
  const dias = automaticoDiario(horas);
  mkdirSync('.cache/automaticos', { recursive: true });
  writeFileSync(ARCHIVO, JSON.stringify(dias));
  return dias;
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

(async () => {
  const auto = await bajar();
  const conAuto = { ...series, 'rosario-auto': auto };
  console.log(`Datos hasta ${fecha}; automático desde ${auto[0]?.dia}, ${auto.length} días.\n`);
  console.log('| Días | Modelo | n | Error sin | Error con | Cambio | Banda sin → con |');
  console.log('|---|---|---|---|---|---|---|');
  const bloques: string[] = [];
  for (const m of [...MODELOS_MEDIO, ...MODELOS].filter((x) => x.horizonte <= 5 && !x.lluvia)) {
    const h = m.horizonte;
    const X: number[][] = [];
    const y: number[] = [];
    for (let d = '2005-01-01'; d <= '2021-12-31'; d = menosDias(d, -1)) {
      const real = rosario.get(menosDias(d, -h));
      const x = predictores(series, d, m);
      const hoy = rosario.get(d);
      const man = rosario.get(menosDias(d, -1));
      if (real === undefined || !x || hoy === undefined || man === undefined) continue;
      X.push([...x, man - hoy]);
      y.push(real);
    }
    const coef = ajustar(X, y).map((c) => Number(c.toFixed(6)));
    const filas: { e: number; e0: number; regimen: Regimen; corrige: boolean }[] = [];
    for (let d = PRUEBA; d <= fecha; d = menosDias(d, -1)) {
      const real = rosario.get(menosDias(d, -h));
      const x = predictores(series, d, m);
      const delta = cambioAutomatico(conAuto, d);
      const regimen = regimenCorrientes(series.corrientes, d);
      if (real === undefined || !x || delta === null || !regimen) continue;
      filas.push({
        e: [...x, delta].reduce((a, v, i) => a + v * coef[i], 0) - real,
        e0: x.reduce((a, v, i) => a + v * m.coef[i], 0) - real,
        regimen,
        corrige: regimen !== 'sube' || diasSubiendo(series.corrientes, d) <= SUBE_SEMANA,
      });
    }
    const bandas = {} as Record<Regimen, [number, number]>;
    const sesgos = {} as Record<Regimen, number>;
    for (const rg of REGIMENES) {
      const xs = filas.filter((f) => f.regimen === rg);
      bandas[rg] = [r2(percentil(xs.map((f) => f.e), 0.1)), r2(percentil(xs.map((f) => f.e), 0.9))];
      sesgos[rg] = r2(percentil(xs.filter((f) => f.corrige).map((f) => f.e), 0.5));
    }
    const mae = (k: 'e' | 'e0') => filas.reduce((a, f) => a + Math.abs(f[k]), 0) / filas.length;
    const ancho = (k: 'e' | 'e0') => Math.round((percentil(filas.map((f) => f[k]), 0.9) - percentil(filas.map((f) => f[k]), 0.1)) * 100);
    console.log(`| ${h} | ${m.medio ? 'con las del medio' : 'cinco estaciones'} | ${filas.length} | ${mae('e0').toFixed(3)} | ${mae('e').toFixed(3)} | ${Math.round((mae('e') / mae('e0') - 1) * 100)} % | ${ancho('e0')} → ${ancho('e')} cm |`);
    bloques.push(`// ${h} días, ${m.medio ? 'MODELOS_MEDIO' : 'MODELOS'}\n    auto: { coef: ${JSON.stringify(coef).replace(/,/g, ', ')}, mae: ${mae('e').toFixed(3)}, bandas: ${JSON.stringify(bandas)}, sesgos: ${JSON.stringify(sesgos)} },`);
  }
  console.log(`\n${bloques.join('\n')}`);
})();
