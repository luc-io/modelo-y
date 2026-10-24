/**
 * Mide `TOPE_CRECIDA` (src/lib/pronostico-rio.ts): el escenario probable a 14
 * y 17 días con y sin el tope, con el mismo `pronosticar` que usa la página.
 * Lee lo que bajó `npm run ajuste-lluvia` en `.cache/ajuste-lluvia-rio/`
 * (correrlo antes), del día más reciente que haya.
 *
 * - 2005-2021 y 2022-2026, con la lluvia que cayó (ERA5): los coeficientes
 *   se ajustaron con 2005-2021, así que la prueba es 2022-2026.
 * - Desde 2024-02-15, con lo que pronosticaba ECMWF, como en vivo.
 *
 * Por grupo de días según cuánto cambió Corrientes en 10: todos, subiendo
 * (más de 40 cm) y en crecida rápida (más de `TOPE_CRECIDA.subida`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { menosDias, type Observacion } from '../src/lib/rio-historia';
import { TOPE_CRECIDA, cambioCorrientes, pronosticar } from '../src/lib/pronostico-rio';
import { DIAS_PRONOSTICO, PUNTOS_TRAMO, lluviaDesdeDias, type LluviaTramo } from '../src/lib/lluvia-tramo';

const CACHE = join(__dirname, '..', '.cache', 'ajuste-lluvia-rio');
const fecha = readdirSync(CACHE)
  .filter((n) => n.startsWith('rio-rosario-'))
  .map((n) => n.slice('rio-rosario-'.length, -'.json'.length))
  .sort()
  .at(-1);
if (!fecha) throw new Error('falta .cache/ajuste-lluvia-rio: correr antes npm run ajuste-lluvia');
const leer = (n: string) => JSON.parse(readFileSync(join(CACHE, `${n}-${fecha}.json`), 'utf8'));

const series: Record<string, Observacion[]> = {};
for (const k of ['rosario', 'corrientes', 'goya', 'reconquista', 'la-paz', 'parana', 'yacyreta']) series[k] = leer(`rio-${k}`);
const rosario = new Map(series.rosario.map((o) => [o.dia, o.metros]));

/** Promedio de los puntos del tramo, día por día; sólo los días que tienen todos. */
function promedio(puntos: Map<string, number>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const [d] of puntos[0]) {
    const vs = puntos.map((p) => p.get(d));
    if (vs.every((v): v is number => v !== undefined)) m.set(d, vs.reduce((a, v) => a + v, 0) / vs.length);
  }
  return m;
}

const era = promedio(
  PUNTOS_TRAMO.map(([lon, lat]) => {
    const j = leer(`era5-${lon}_${lat}`);
    const m = new Map<string, number>();
    j.daily.time.forEach((t: string, i: number) => {
      const v = j.daily.precipitation_sum[i];
      if (v !== null) m.set(t, v);
    });
    return m;
  }),
);

// Lo que ECMWF pronosticó para cada día con 1 a 7 días de anticipación, como en el ajuste.
const vars = Array.from({ length: DIAS_PRONOSTICO }, (_, i) => `precipitation_previous_day${i + 1}`);
const porAnticipacion: Map<string, number>[][] = vars.map(() => []);
for (const [lon, lat] of PUNTOS_TRAMO) {
  const j = leer(`ecmwf-${lon}_${lat}`);
  vars.forEach((v, k) => {
    const suma = new Map<string, { s: number; n: number }>();
    j.hourly.time.forEach((t: string, i: number) => {
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
const ecmwf = new Map<string, number[]>();
for (const [d] of medias[0]) {
  const vs = medias.map((x) => x.get(d));
  if (vs.every((v): v is number => v !== undefined)) ecmwf.set(d, vs);
}

// Lluvia típica por día del año, de ERA5 2005-2021, ±15 días.
const doy = (d: string) => Math.floor((Date.parse(d) - Date.parse(`${d.slice(0, 4)}-01-01`)) / 86_400_000);
const suma = new Array(366).fill(0);
const n = new Array(366).fill(0);
for (const [d, v] of era) {
  if (d < '2005-01-01' || d > '2021-12-31') continue;
  for (let j = -15; j <= 15; j++) {
    const k = (doy(d) + j + 366) % 366;
    suma[k] += v;
    n[k]++;
  }
}
const tipica = (d: string) => suma[doy(d)] / n[doy(d)];

const lluviaEra5 = lluviaDesdeDias(era, tipica);
const lluviaEcmwf: LluviaTramo = {
  pasada(d) {
    let s = 0;
    for (let k = 0; k < 7; k++) {
      const v = ecmwf.get(menosDias(d, k))?.[0];
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
        const v = ecmwf.get(dia)?.[k - 1];
        if (v === undefined) return null;
        s += v;
      } else s += tipica(dia);
    }
    return s;
  },
};

function sinTope(d: string, lluvia: LluviaTramo) {
  const t = TOPE_CRECIDA.metros;
  TOPE_CRECIDA.metros = Infinity;
  const p = pronosticar(series, d, lluvia);
  TOPE_CRECIDA.metros = t;
  return p;
}

function medir(nombre: string, desde: string, hasta: string, lluvia: LluviaTramo) {
  for (const h of [14, 17]) {
    const grupos: Record<string, { antes: number[]; despues: number[]; cubreAntes: number; cubreDespues: number }> = {};
    for (let d = desde; d <= hasta; d = menosDias(d, -1)) {
      const real = rosario.get(menosDias(d, -h));
      const c = cambioCorrientes(series.corrientes, d);
      if (real === undefined || c === null) continue;
      const dia = menosDias(d, 1 - h);
      const a = sinTope(d, lluvia).find((p) => p.dia === dia);
      const b = pronosticar(series, d, lluvia).find((p) => p.dia === dia);
      if (!a || !b) continue;
      const cuales = ['todos', ...(c > 0.4 ? ['subiendo'] : []), ...(c > TOPE_CRECIDA.subida ? ['crecida rápida'] : [])];
      for (const g of cuales) {
        const x = (grupos[g] ??= { antes: [], despues: [], cubreAntes: 0, cubreDespues: 0 });
        x.antes.push(Math.abs(a.metros - real));
        x.despues.push(Math.abs(b.metros - real));
        if (real >= a.min && real <= a.max) x.cubreAntes++;
        if (real >= b.min && real <= b.max) x.cubreDespues++;
      }
    }
    const media = (xs: number[]) => (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(3);
    const pct = (k: number, xs: number[]) => `${Math.round((100 * k) / xs.length)} %`;
    for (const [g, x] of Object.entries(grupos)) {
      console.log(
        `| ${nombre} | ${h} | ${g} | ${x.antes.length} | ${media(x.antes)} | ${media(x.despues)} | ${pct(x.cubreAntes, x.antes)} | ${pct(x.cubreDespues, x.antes)} |`,
      );
    }
  }
}

console.log(`Datos del ${fecha}. Error absoluto medio en metros; «cubre»: lo real adentro de la banda.\n`);
console.log('| Período | Días | Grupo | n | Error sin tope | Error con tope | Cubre sin | Cubre con |');
console.log('|---|---|---|---|---|---|---|---|');
medir('2005-2021, ERA5 (ajuste)', '2005-01-01', '2021-12-31', lluviaEra5);
medir('2022-2026, ERA5', '2022-01-01', menosDias(fecha, 17), lluviaEra5);
medir('desde 2024-02-15, ECMWF', '2024-02-15', menosDias(fecha, 17), lluviaEcmwf);
