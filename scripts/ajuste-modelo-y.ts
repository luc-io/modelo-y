/**
 * Reajusta el Modelo Y entero —base, con lluvia y con Yacyretá— con un
 * conjunto de estaciones dado, mide sus bandas y sesgos como se publican, y
 * lo compara con lo que está en producción sobre los mismos días. Imprime las
 * constantes para pegar en src/lib/pronostico-rio.ts.
 *
 * Por qué (6/11/2026): cada horizonte usaba sólo las estaciones cuya agua
 * todavía no llegó a Rosario, y no veía cómo están hoy las de abajo. En la
 * crecida de octubre-noviembre el pico ya había pasado Goya y Reconquista y
 * el escenario a 14 días seguía subiendo porque sólo miraba Corrientes. Con
 * las cinco estaciones en todos los horizontes —las que ya pasaron, con su
 * dato de hoy— el error de la regresión baja 10-15 % de 7 a 17 días
 * (`npm run estaciones-medias`).
 *
 * - Base: ajuste 2005-2021, bandas y sesgos 2022-2026 (como `margen-rio`).
 * - Lluvia y Yacyretá: ajuste 2005-2021 con la lluvia que cayó (ERA5);
 *   bandas, sesgos y error desde 2024-02-15 con lo que pronosticaba ECMWF
 *   (como `ajuste-lluvia-rio`).
 * - El sesgo «sube» se mide en la primera semana de la subida, que es donde
 *   se aplica (`SUBE_SEMANA`); las bandas, en todos los días del régimen.
 *
 * Lee `.cache/ajuste-lluvia-rio/` (correr antes `npm run ajuste-lluvia`).
 * Corre con `npm run ajuste-modelo-y`.
 */
import { menosDias } from '../src/lib/rio-historia';
import {
  BANDAS,
  BANDAS_LLUVIA,
  BANDAS_REPRESA,
  ESTACIONES_MEDIO,
  ESTACIONES_Y,
  MODELOS,
  MODELOS_LLUVIA,
  MODELOS_REPRESA,
  REGIMENES,
  SESGOS,
  SESGOS_LLUVIA,
  SESGOS_REPRESA,
  diasSubiendo,
  SUBE_SEMANA,
  predictores,
  predictoresCambio,
  regimenCorrientes,
  regresion,
  type ModeloRio,
  type Regimen,
} from '../src/lib/pronostico-rio';
import type { LluviaTramo } from '../src/lib/lluvia-tramo';
import { fecha, lluviaEcmwf, lluviaEra5, rosario, series } from './datos-ajuste';

const USA = ESTACIONES_Y;
const PRUEBA_BASE = '2022-01-01';
const PRUEBA_ECMWF = '2024-02-15';

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

type Tablas = { bandas: Record<number, Record<Regimen, [number, number]>>; sesgos: Record<number, Record<Regimen, number>> };

/** Un día de prueba: lo real, el régimen y si la corrección «sube» va. */
interface Dia {
  d: string;
  real: number;
  regimen: Regimen;
  corrige: boolean;
}

function diasPrueba(h: number, desde: string): Dia[] {
  const out: Dia[] = [];
  for (let d = desde; d <= fecha; d = menosDias(d, -1)) {
    const real = rosario.get(menosDias(d, -h));
    const regimen = regimenCorrientes(series.corrientes, d);
    if (real === undefined || !regimen) continue;
    out.push({ d, real, regimen, corrige: regimen !== 'sube' || diasSubiendo(series.corrientes, d) <= SUBE_SEMANA });
  }
  return out;
}

/** Desde qué horizonte va la mezcla con el gemelo «sólo variaciones» (`PESO_ALTURA`). */
const MEZCLA_DESDE = 7;

function ajustarModelo(molde: ModeloRio, lluvia: LluviaTramo | null): ModeloRio {
  const X: number[][] = [];
  const y: number[] = [];
  const Xc: number[][] = [];
  const yc: number[] = [];
  const { cambios: _, ...sinGemelo } = molde;
  void _;
  for (let d = '2005-01-01'; d <= '2021-12-31'; d = menosDias(d, -1)) {
    const real = rosario.get(menosDias(d, -molde.horizonte));
    const x = predictores(series, d, sinGemelo, lluvia ?? undefined);
    if (real === undefined || x === null) continue;
    X.push(x);
    y.push(real);
    // El gemelo, los días que tienen sus datos: pronostica el cambio.
    const xc = molde.horizonte >= MEZCLA_DESDE ? predictoresCambio(series, d, sinGemelo, lluvia ?? undefined) : null;
    if (xc) {
      Xc.push(xc);
      yc.push(real - x[1]);
    }
  }
  const coef = ajustar(X, y).map(r6);
  return Xc.length > 500 ? { ...sinGemelo, coef, cambios: ajustar(Xc, yc).map(r6) } : { ...sinGemelo, coef };
}

/** Bandas (todos los días del régimen) y sesgos («sube», sólo donde se aplica). */
function medirTablas(h: number, errores: { e: number; dia: Dia }[], t: Tablas) {
  t.bandas[h] = {} as Record<Regimen, [number, number]>;
  t.sesgos[h] = {} as Record<Regimen, number>;
  for (const rg of REGIMENES) {
    const xs = errores.filter((x) => x.dia.regimen === rg);
    t.bandas[h][rg] = [r2(percentil(xs.map((x) => x.e), 0.1)), r2(percentil(xs.map((x) => x.e), 0.9))];
    t.sesgos[h][rg] = r2(percentil(xs.filter((x) => x.dia.corrige).map((x) => x.e), 0.5));
  }
}

/** Lo que ve la gente: el centro corregido y si lo real cae en la banda. */
function publicado(h: number, filas: { crudo: number; dia: Dia }[], t: Tablas) {
  let abs = 0;
  let dentro = 0;
  let ancho = 0;
  for (const { crudo, dia } of filas) {
    const [p10, p90] = t.bandas[h][dia.regimen];
    const centro = crudo - (dia.corrige ? t.sesgos[h][dia.regimen] : 0);
    abs += Math.abs(centro - dia.real);
    if (dia.real >= crudo - p90 && dia.real <= crudo - p10) dentro++;
    ancho += p90 - p10;
  }
  const n = filas.length;
  return { mae: abs / n, cubre: dentro / n, ancho: ancho / n };
}

function familia(
  nombre: string,
  viejos: ModeloRio[],
  viejas: Tablas,
  lluviaAjuste: LluviaTramo | null,
  lluviaPrueba: LluviaTramo | null,
  desde: string,
  /** Cómo armar el nuevo a partir del viejo; de entrada, el mismo con `USA`. */
  molde: (m: ModeloRio) => ModeloRio = (m) => ({ ...m, usa: USA, coef: [] }),
) {
  const nuevos: ModeloRio[] = [];
  const nuevas: Tablas = { bandas: {}, sesgos: {} };
  const tabla: string[] = [];
  for (const viejo of viejos) {
    const h = viejo.horizonte;
    const nuevo = ajustarModelo(molde(viejo), lluviaAjuste);
    // Los mismos días para los dos: los que tienen todo.
    const filas: { viejo: number; nuevo: number; dia: Dia }[] = [];
    for (const dia of diasPrueba(h, desde)) {
      const v = regresion(series, dia.d, viejo, lluviaPrueba ?? undefined);
      const n = regresion(series, dia.d, nuevo, lluviaPrueba ?? undefined);
      if (v === null || n === null) continue;
      filas.push({ viejo: v, nuevo: n, dia });
    }
    medirTablas(h, filas.map((f) => ({ e: f.nuevo - f.dia.real, dia: f.dia })), nuevas);
    nuevo.mae = Number((filas.reduce((a, f) => a + Math.abs(f.nuevo - f.dia.real), 0) / filas.length).toFixed(3));
    nuevos.push(nuevo);
    const a = publicado(h, filas.map((f) => ({ crudo: f.viejo, dia: f.dia })), viejas);
    const b = publicado(h, filas.map((f) => ({ crudo: f.nuevo, dia: f.dia })), nuevas);
    // La crecida de octubre de 2026, aparte.
    const oct = filas.filter((f) => f.dia.d >= '2026-10-01' && f.dia.d <= '2026-10-31');
    const co = (k: 'viejo' | 'nuevo', t: Tablas) =>
      oct.length ? publicado(h, oct.map((f) => ({ crudo: f[k], dia: f.dia })), t).mae.toFixed(3) : '—';
    tabla.push(
      `| ${h} | ${filas.length} | ${a.mae.toFixed(3)} | ${b.mae.toFixed(3)} | ${Math.round((b.mae / a.mae - 1) * 100)} % | ` +
        `${Math.round(a.ancho * 100)} → ${Math.round(b.ancho * 100)} cm | ${Math.round(a.cubre * 100)} → ${Math.round(b.cubre * 100)} % | ${co('viejo', viejas)} → ${co('nuevo', nuevas)} |`,
    );
  }
  console.log(`\n## ${nombre} (prueba desde ${desde})\n`);
  console.log('| Días | n | Error antes | Error ahora | Cambio | Banda | Cubre | Crecida oct-26 |');
  console.log('|---|---|---|---|---|---|---|---|');
  console.log(tabla.join('\n'));
  console.log(`\n${JSON.stringify(nuevos)}\nBANDAS ${JSON.stringify(nuevas.bandas)}\nSESGOS ${JSON.stringify(nuevas.sesgos)}`);
}

console.log(`Datos hasta ${fecha}. Estaciones: ${USA.join(', ')}; las que ya pasaron, con su dato de hoy.`);
familia('Base', MODELOS, { bandas: BANDAS, sesgos: SESGOS }, null, null, PRUEBA_BASE);
familia('Con lluvia', MODELOS_LLUVIA, { bandas: BANDAS_LLUVIA, sesgos: SESGOS_LLUVIA }, lluviaEra5, lluviaEcmwf, PRUEBA_ECMWF);
familia('Con Yacyretá', MODELOS_REPRESA, { bandas: BANDAS_REPRESA, sesgos: SESGOS_REPRESA }, lluviaEra5, lluviaEcmwf, PRUEBA_ECMWF);

// Las del medio, contra lo que sale hoy en cada horizonte: 3 y 5 sin lluvia, 7 y 10 con lluvia.
if (ESTACIONES_MEDIO.every((k) => series[k])) {
  const medio = (m: ModeloRio): ModeloRio => ({ ...m, usa: [...USA, ...ESTACIONES_MEDIO], coef: [], medio: true });
  familia('Con las del medio, sin lluvia', MODELOS.filter((m) => m.horizonte <= 5), { bandas: BANDAS, sesgos: SESGOS }, null, null, PRUEBA_BASE, medio);
  familia('Con las del medio, con lluvia', MODELOS_LLUVIA.filter((m) => m.horizonte <= 10), { bandas: BANDAS_LLUVIA, sesgos: SESGOS_LLUVIA }, lluviaEra5, lluviaEcmwf, PRUEBA_ECMWF, medio);
} else {
  console.log('\nFaltan las estaciones del medio en el caché: correr `npm run estaciones-medias`.');
}
