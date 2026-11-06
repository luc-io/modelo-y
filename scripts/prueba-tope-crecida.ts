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
import { menosDias } from '../src/lib/rio-historia';
import { TOPE_CRECIDA, cambioCorrientes, pronosticar, topeCrecidaActivo } from '../src/lib/pronostico-rio';
import type { LluviaTramo } from '../src/lib/lluvia-tramo';
import { fecha, lluviaEcmwf, lluviaEra5, rosario, series } from './datos-ajuste';

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
