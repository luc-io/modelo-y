/**
 * Mide la banda de error del pronóstico propio de Rosario por régimen de
 * Corrientes. Corre con `npm run margen-rio` e imprime los percentiles que van
 * en `BANDAS` (p10 y p90) y en `SESGOS` (p50) de `src/lib/pronostico-rio.ts`.
 *
 * Cómo: se baja la serie diaria de cada estación del INA (de a una: la API
 * corta con 429 si se le piden varias juntas) y se repite la historia día por
 * día con el mismo `predecir` que usa la página. El error es lo pronosticado
 * menos lo que marcó Rosario ese día. Cada día se clasifica por cuánto cambió
 * Corrientes en los 10 días previos, con el mismo `regimenCorrientes`.
 *
 * Se mide en 2022-2026, que el ajuste de los coeficientes no vio. 2005-2021
 * se imprime para comparar: ahí el error sale más chico porque es la muestra
 * con que se ajustó.
 *
 * Lo bajado queda en `.cache/margen-rio/` y no se vuelve a pedir en el día.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { traerSerie, estacionRio, menosDias, type Observacion } from '../src/lib/rio-historia';
import { MODELOS, REGIMENES, regresion, regimenCorrientes, type Regimen } from '../src/lib/pronostico-rio';

const PERIODOS = [
  { nombre: '2022-2026 (fuera del ajuste)', desde: '2022-01-01', hasta: '2026-12-31' },
  { nombre: '2005-2021 (muestra del ajuste)', desde: '2005-01-01', hasta: '2021-12-31' },
];
const CACHE = join(__dirname, '..', '.cache', 'margen-rio');
const hoy = new Date().toISOString().slice(0, 10);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function serie(slug: string): Promise<Observacion[]> {
  const archivo = join(CACHE, `${slug}-${hoy}.json`);
  if (existsSync(archivo)) return JSON.parse(readFileSync(archivo, 'utf8'));
  const e = estacionRio(slug);
  if (!e) throw new Error(`no hay estación ${slug}`);
  for (let i = 0; ; i++) {
    try {
      const s = await traerSerie(e.serie, '2004-11-01', hoy);
      writeFileSync(archivo, JSON.stringify(s));
      return s;
    } catch (err) {
      if (i >= 5) throw err;
      console.log(`  ${slug}: ${(err as Error).message}, reintento en ${20 * (i + 1)} s`);
      await esperar(20_000 * (i + 1));
    }
  }
}

function percentil(xs: number[], p: number): number {
  const o = [...xs].sort((a, b) => a - b);
  const i = (o.length - 1) * p;
  const a = Math.floor(i);
  return o[a] + (o[Math.min(a + 1, o.length - 1)] - o[a]) * (i - a);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const slugs = ['rosario', ...new Set(MODELOS.flatMap((m) => m.usa))];
  const series: Record<string, Observacion[]> = {};
  // De a una, con pausa: el INA corta con 429 si se le piden en paralelo.
  for (const k of slugs) {
    console.log(`bajando ${k}…`);
    series[k] = await serie(k);
    await esperar(1500);
  }
  const rosario = new Map(series.rosario.map((o) => [o.dia, o.metros]));

  for (const per of PERIODOS) {
    console.log(`\n${per.nombre}`);
    const salida: Record<string, Record<Regimen, [number, number]>> = {};
    const medianas: Record<string, Record<Regimen, number>> = {};
    for (const m of MODELOS) {
      const errores: Record<Regimen, number[]> = { sube: [], baja: [], resto: [] };
      const todos: number[] = [];
      for (let d = per.desde; d <= per.hasta && d <= hoy; d = menosDias(d, -1)) {
        // Lo real es la serie del INA `horizonte` días después; `Punto.dia`
        // está corrido uno para atrás por la fecha del cuadro de Prefectura.
        const real = rosario.get(menosDias(d, -m.horizonte));
        if (real === undefined) continue;
        const p = regresion(series, d, m);
        if (p === null) continue;
        const r = regimenCorrientes(series.corrientes, d);
        if (!r) continue;
        const e = p - real;
        errores[r].push(e);
        todos.push(e);
      }
      const mae = todos.reduce((a, e) => a + Math.abs(e), 0) / todos.length;
      const fila = [`${String(m.horizonte).padStart(2)} d  mae ${mae.toFixed(3)} (n ${todos.length})`];
      salida[m.horizonte] = {} as Record<Regimen, [number, number]>;
      medianas[m.horizonte] = {} as Record<Regimen, number>;
      for (const r of REGIMENES) {
        const xs = errores[r];
        const p10 = percentil(xs, 0.1);
        const p50 = percentil(xs, 0.5);
        const p90 = percentil(xs, 0.9);
        const sesgo = xs.reduce((a, e) => a + e, 0) / xs.length;
        salida[m.horizonte][r] = [Number(p10.toFixed(2)), Number(p90.toFixed(2))];
        medianas[m.horizonte][r] = Number(p50.toFixed(2));
        fila.push(`${r}: p10 ${p10.toFixed(2)} p50 ${p50.toFixed(2)} p90 ${p90.toFixed(2)} sesgo ${sesgo.toFixed(2)} (n ${xs.length})`);
      }
      console.log(fila.join('  |  '));
    }
    console.log(`BANDAS ${JSON.stringify(salida)}`);
    console.log(`SESGOS ${JSON.stringify(medianas)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
