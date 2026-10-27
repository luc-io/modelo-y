/**
 * Mide `TOPE_CRECIDA` (src/lib/pronostico-rio.ts): el escenario probable a 14
 * y 17 días sin tope, con el tope sin memoria (sólo el día en que Corrientes
 * subió más de `TOPE_CRECIDA.subida` en 10 días) y con la memoria de
 * `TOPE_CRECIDA.memoria` días, que es lo que se publica. Usa el mismo
 * `pronosticar` que la página. Lee lo que bajó `npm run ajuste-lluvia` en
 * `.cache/ajuste-lluvia-rio/` (correrlo antes), del día más reciente que haya.
 *
 * - 2005-2021 y 2022-2026, con la lluvia que cayó (ERA5): los coeficientes
 *   se ajustaron con 2005-2021, así que la prueba es 2022-2026.
 * - Desde 2024-02-15, con lo que pronosticaba ECMWF, como en vivo.
 *
 * Por grupo de días: todos, Corrientes subiendo (más de 40 cm en 10), con el
 * tope prendido, y aquellos en que la memoria cambia el número.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { menosDias, type Observacion } from '../src/lib/rio-historia';
import { TOPE_CRECIDA, cambioCorrientes, pronosticar, topeCrecidaActivo } from '../src/lib/pronostico-rio';
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

/** `pronosticar` con otro tope o memoria, y después deja `TOPE_CRECIDA` como estaba. */
function con(d: string, lluvia: LluviaTramo, cambios: Partial<typeof TOPE_CRECIDA>) {
  const antes = { ...TOPE_CRECIDA };
  Object.assign(TOPE_CRECIDA, cambios);
  const p = pronosticar(series, d, lluvia);
  Object.assign(TOPE_CRECIDA, antes);
  return p;
}

const VARIANTES = ['sin tope', 'sin memoria', 'con memoria'] as const;

function medir(nombre: string, desde: string, hasta: string, lluvia: LluviaTramo) {
  for (const h of [14, 17]) {
    const grupos: Record<string, { err: number[][]; cubre: number[] }> = {};
    for (let d = desde; d <= hasta; d = menosDias(d, -1)) {
      const real = rosario.get(menosDias(d, -h));
      const c = cambioCorrientes(series.corrientes, d);
      if (real === undefined || c === null) continue;
      const dia = menosDias(d, 1 - h);
      const ps = [
        con(d, lluvia, { metros: Infinity }),
        con(d, lluvia, { memoria: 0 }),
        pronosticar(series, d, lluvia),
      ].map((p) => p.find((x) => x.dia === dia));
      if (ps.some((p) => !p)) continue;
      const [, sinMemoria, conMemoria] = ps;
      const cuales = [
        'todos',
        ...(c > 0.4 ? ['subiendo'] : []),
        ...(topeCrecidaActivo(series.corrientes, d) ? ['con tope'] : []),
        ...(sinMemoria!.metros !== conMemoria!.metros ? ['cambia la memoria'] : []),
      ];
      for (const g of cuales) {
        const x = (grupos[g] ??= { err: VARIANTES.map(() => []), cubre: VARIANTES.map(() => 0) });
        ps.forEach((p, i) => {
          x.err[i].push(Math.abs(p!.metros - real));
          if (real >= p!.min && real <= p!.max) x.cubre[i]++;
        });
      }
    }
    const media = (xs: number[]) => (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(3);
    const pct = (k: number, n: number) => `${Math.round((100 * k) / n)} %`;
    for (const [g, x] of Object.entries(grupos)) {
      const n = x.err[0].length;
      console.log(`| ${nombre} | ${h} | ${g} | ${n} | ${x.err.map(media).join(' | ')} | ${x.cubre.map((k) => pct(k, n)).join(' | ')} |`);
    }
  }
}

console.log(`Datos del ${fecha}. Error absoluto medio en metros; «cubre»: lo real adentro de la banda.\n`);
console.log('| Período | Días | Grupo | n | Error sin tope | Error sin memoria | Error con memoria | Cubre sin tope | Cubre sin memoria | Cubre con memoria |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
medir('2005-2021, ERA5 (ajuste)', '2005-01-01', '2021-12-31', lluviaEra5);
medir('2022-2026, ERA5', '2022-01-01', menosDias(fecha, 17), lluviaEra5);
medir('desde 2024-02-15, ECMWF', '2024-02-15', menosDias(fecha, 17), lluviaEcmwf);
