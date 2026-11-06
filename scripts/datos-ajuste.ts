/**
 * Lo que bajó `npm run ajuste-lluvia` en `.cache/ajuste-lluvia-rio/`, del
 * día más reciente que haya, listo para repetir la historia con `pronosticar`:
 * las series del río, la lluvia que cayó (ERA5) y la que pronosticaba ECMWF.
 * Lo usan las pruebas que miden el escenario probable como se publica.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { menosDias, type Observacion } from '../src/lib/rio-historia';
import { DIAS_PRONOSTICO, PUNTOS_TRAMO, lluviaDesdeDias, type LluviaTramo } from '../src/lib/lluvia-tramo';

const CACHE = join(__dirname, '..', '.cache', 'ajuste-lluvia-rio');
const ultima = readdirSync(CACHE)
  .filter((n) => n.startsWith('rio-rosario-'))
  .map((n) => n.slice('rio-rosario-'.length, -'.json'.length))
  .sort()
  .at(-1);
if (!ultima) throw new Error('falta .cache/ajuste-lluvia-rio: correr antes npm run ajuste-lluvia');
/** El día de lo bajado: las series llegan hasta el anterior. */
export const fecha: string = ultima;
const leer = (n: string) => JSON.parse(readFileSync(join(CACHE, `${n}-${fecha}.json`), 'utf8'));

export const series: Record<string, Observacion[]> = {};
for (const k of ['rosario', 'corrientes', 'goya', 'reconquista', 'la-paz', 'parana', 'yacyreta']) series[k] = leer(`rio-${k}`);
export const rosario = new Map(series.rosario.map((o) => [o.dia, o.metros]));

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

export const lluviaEra5 = lluviaDesdeDias(era, tipica);
export const lluviaEcmwf: LluviaTramo = {
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
