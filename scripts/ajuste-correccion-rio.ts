/**
 * Ajusta y mide la corrección no lineal del Modelo Y (src/lib/correccion-rio.ts)
 * y escribe los árboles en src/lib/correccion-rio-datos.ts. Imprime las bandas
 * y sesgos para pegar en src/lib/pronostico-rio.ts.
 *
 * Qué aprende: el error de la regresión de `MODELOS_MEDIO` (pronosticado −
 * real) a 3, 5, 7 y 10 días, con árboles de dos preguntas sumados de a poco
 * (boosting por gradiente, pérdida cuadrática). Mira a Rosario y a las cinco
 * estaciones como están hoy: altura y cambio en 1, 3 y 10 días.
 *
 * - Ajuste: 2005-2021, con la lluvia que cayó (ERA5) en la regresión de 7 y 10.
 * - Medición, como el resto del modelo: 3 y 5 días en 2022-2026; 7 y 10 desde
 *   2024-02-15 con lo que pronosticaba ECMWF. De ahí salen bandas y sesgos.
 * - Validación aparte: ajuste 2005-2015, medición 2016-2021. Un horizonte
 *   entra sólo si mejora en los dos.
 * - La variante con el automático de Rosario (3 y 5 días), con el automático
 *   de verdad en 2022-2026 (`.cache/automaticos/`, lo baja `npm run ajuste-auto`).
 *
 * Lee `.cache/ajuste-lluvia-rio/` (correr antes `npm run ajuste-lluvia` y
 * `npm run estaciones-medias`). Corre con `npm run ajuste-correccion`;
 * con `--probar` mide sin escribir el archivo.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { menosDias, type Observacion } from '../src/lib/rio-historia';
import {
  BANDAS_MEDIO,
  MODELOS_MEDIO,
  REGIMENES,
  SESGOS_MEDIO,
  SUBE_SEMANA,
  cambioAutomatico,
  diasSubiendo,
  predictores,
  regimenCorrientes,
  regresion,
  type ModeloRio,
  type Regimen,
} from '../src/lib/pronostico-rio';
import { NOMBRES_CORRECCION, predictoresCorreccion, sumarArboles, type Arbol } from '../src/lib/correccion-rio';
import type { LluviaTramo } from '../src/lib/lluvia-tramo';
import { fecha, lluviaEcmwf, lluviaEra5, rosario, series } from './datos-ajuste';

const HORIZONTES = [3, 5, 7, 10];
const PRUEBA_BASE = '2022-01-01';
const PRUEBA_ECMWF = '2024-02-15';
/** Cantidad de árboles, cuánto pesa cada uno, y el mínimo de días por hoja. */
const ARBOLES = 150;
const PASO = 0.1;
const MIN_HOJA = 60;
const CORTES = 32;

// ───────────── boosting de árboles de dos preguntas ─────────────

/** Hasta `CORTES` umbrales por predictor: cuantiles de lo visto en el ajuste. */
function umbrales(X: number[][]): number[][] {
  return X[0].map((_, j) => {
    const o = X.map((x) => x[j]).sort((a, b) => a - b);
    const u = new Set<number>();
    for (let k = 1; k < CORTES; k++) u.add(Number(o[Math.floor((k * o.length) / CORTES)].toFixed(3)));
    return [...u].sort((a, b) => a - b);
  });
}

interface Corte {
  j: number;
  c: number;
  gana: number;
}

/** El mejor corte de las filas `idx`: el que más baja el error cuadrático dejando `MIN_HOJA` de cada lado. */
function mejorCorte(X: number[][], r: number[], idx: number[], U: number[][]): Corte | null {
  let total = 0;
  for (const i of idx) total += r[i];
  const n = idx.length;
  let mejor: Corte | null = null;
  for (let j = 0; j < U.length; j++) {
    const u = U[j];
    // Suma y cuenta por tramo entre umbrales; después se acumula de izquierda a derecha.
    const s = new Array(u.length + 1).fill(0);
    const k = new Array(u.length + 1).fill(0);
    for (const i of idx) {
      const v = X[i][j];
      let b = 0;
      while (b < u.length && v > u[b]) b++;
      s[b] += r[i];
      k[b]++;
    }
    let si = 0;
    let ki = 0;
    for (let b = 0; b < u.length; b++) {
      si += s[b];
      ki += k[b];
      if (ki < MIN_HOJA || n - ki < MIN_HOJA) continue;
      const gana = (si * si) / ki + ((total - si) * (total - si)) / (n - ki) - (total * total) / n;
      if (!mejor || gana > mejor.gana) mejor = { j, c: u[b], gana };
    }
  }
  return mejor;
}

const media = (r: number[], idx: number[]) => (idx.length ? idx.reduce((a, i) => a + r[i], 0) / idx.length : 0);
const r4 = (v: number) => Number(v.toFixed(4));

/** Los árboles que, sumados, aproximan `y` a partir de `X`. */
function ajustarArboles(X: number[][], y: number[]): Arbol[] {
  const U = umbrales(X);
  const r = [...y];
  const todas = X.map((_, i) => i);
  const arboles: Arbol[] = [];
  for (let n = 0; n < ARBOLES; n++) {
    const raiz = mejorCorte(X, r, todas, U);
    if (!raiz) break;
    const izq = todas.filter((i) => X[i][raiz.j] <= raiz.c);
    const der = todas.filter((i) => X[i][raiz.j] > raiz.c);
    const rama = (idx: number[]): [number, number, number, number] => {
      const c = mejorCorte(X, r, idx, U);
      // Sin corte posible, una pregunta que siempre da la misma hoja.
      if (!c) return [0, 1e9, r4(PASO * media(r, idx)), 0];
      return [c.j, c.c, r4(PASO * media(r, idx.filter((i) => X[i][c.j] <= c.c))), r4(PASO * media(r, idx.filter((i) => X[i][c.j] > c.c)))];
    };
    const [j1, c1, a, b] = rama(izq);
    const [j2, c2, c, d] = rama(der);
    const t: Arbol = [raiz.j, raiz.c, j1, c1, j2, c2, a, b, c, d];
    arboles.push(t);
    for (const i of todas) r[i] -= sumarArboles([t], X[i]);
  }
  return arboles;
}

// ───────────── datos ─────────────

/** Los predictores de la corrección, una vez por día. */
const memoria = new Map<string, number[] | null>();
const xDe = (d: string) => {
  if (!memoria.has(d)) memoria.set(d, predictoresCorreccion(series, d));
  return memoria.get(d)!;
};

interface Fila {
  d: string;
  x: number[];
  /** La regresión sola y lo que pasó. */
  crudo: number;
  real: number;
  regimen: Regimen | null;
  corrige: boolean;
}

function filas(m: ModeloRio, lluvia: LluviaTramo | null, desde: string, hasta: string, crudoDe?: (d: string) => number | null): Fila[] {
  const out: Fila[] = [];
  for (let d = desde; d <= hasta; d = menosDias(d, -1)) {
    const real = rosario.get(menosDias(d, -m.horizonte));
    if (real === undefined) continue;
    const crudo = crudoDe ? crudoDe(d) : regresion(series, d, m, lluvia ?? undefined);
    const x = xDe(d);
    if (crudo === null || x === null) continue;
    const regimen = regimenCorrientes(series.corrientes, d);
    out.push({ d, x, crudo, real, regimen, corrige: regimen !== 'sube' || diasSubiendo(series.corrientes, d) <= SUBE_SEMANA });
  }
  return out;
}

function percentil(xs: number[], p: number): number {
  const o = [...xs].sort((a, b) => a - b);
  const i = (o.length - 1) * p;
  const a = Math.floor(i);
  return o[a] + (o[Math.min(a + 1, o.length - 1)] - o[a]) * (i - a);
}
const r2 = (v: number) => Number(v.toFixed(2));
const mae = (xs: number[]) => xs.reduce((a, e) => a + Math.abs(e), 0) / xs.length;

type Tabla = { bandas: Record<Regimen, [number, number]>; sesgos: Record<Regimen, number> };

/** Bandas (p10-p90 del error crudo) y sesgos (mediana donde se corrige), por régimen. */
function medirTabla(fs: { e: number; f: Fila }[]): Tabla {
  const t: Tabla = { bandas: {} as Tabla['bandas'], sesgos: {} as Tabla['sesgos'] };
  for (const rg of REGIMENES) {
    const xs = fs.filter((x) => x.f.regimen === rg);
    t.bandas[rg] = [r2(percentil(xs.map((x) => x.e), 0.1)), r2(percentil(xs.map((x) => x.e), 0.9))];
    t.sesgos[rg] = r2(percentil(xs.filter((x) => x.f.corrige).map((x) => x.e), 0.5));
  }
  return t;
}

/** Lo que ve la gente: error del centro (crudo − sesgo), cuánto cubre la banda y su ancho. */
function publicado(fs: { e: number; f: Fila }[], t: Tabla) {
  let abs = 0;
  let dentro = 0;
  let ancho = 0;
  let n = 0;
  for (const { e, f } of fs) {
    if (!f.regimen) continue;
    const [p10, p90] = t.bandas[f.regimen];
    abs += Math.abs(e - (f.corrige ? t.sesgos[f.regimen] : 0));
    if (e >= p10 && e <= p90) dentro++;
    ancho += p90 - p10;
    n++;
  }
  return { mae: abs / n, cubre: dentro / n, ancho: ancho / n };
}

const pct = (a: number, b: number) => `${Math.round((b / a - 1) * 100)} %`;

// ───────────── ajuste y medición ─────────────

const probar = process.argv.includes('--probar');
const todos: Record<number, Arbol[]> = {};
const tablas: Record<number, Tabla> = {};
const tablasAuto: Record<number, Tabla> = {};
const lineas: string[] = [];
const validacion: string[] = [];
const autoLineas: string[] = [];
const usados: Record<number, Map<number, number>> = {};

const ARCHIVO_AUTO = '.cache/automaticos/rosario-diario.json';
const auto: Observacion[] | null = existsSync(ARCHIVO_AUTO) ? JSON.parse(readFileSync(ARCHIVO_AUTO, 'utf8')) : null;
const conAuto = auto ? { ...series, 'rosario-auto': auto } : null;

console.log(`Datos hasta ${fecha}. ${ARBOLES} árboles de dos preguntas, paso ${PASO}, hojas de ${MIN_HOJA} días o más.\n`);
for (const h of HORIZONTES) {
  const m = MODELOS_MEDIO.find((x) => x.horizonte === h)!;
  const era = m.lluvia ? lluviaEra5 : null;

  // Validación: 2005-2015 → 2016-2021.
  const v0 = filas(m, era, '2005-01-01', menosDias('2015-12-31', h));
  const v1 = filas(m, era, '2016-01-01', '2021-12-31');
  const av = ajustarArboles(v0.map((f) => f.x), v0.map((f) => f.real - f.crudo));
  const ev0 = mae(v1.map((f) => f.crudo - f.real));
  const ev1 = mae(v1.map((f) => f.crudo + sumarArboles(av, f.x) - f.real));
  validacion.push(`| ${h} | ${v1.length} | ${ev0.toFixed(3)} | ${ev1.toFixed(3)} | ${pct(ev0, ev1)} |`);

  // Lo que se publica: 2005-2021 → 2022-2026.
  const tr = filas(m, era, '2005-01-01', menosDias('2021-12-31', h));
  const arboles = ajustarArboles(tr.map((f) => f.x), tr.map((f) => f.real - f.crudo));
  todos[h] = arboles;
  usados[h] = new Map();
  for (const t of arboles) for (const j of [t[0], t[2], t[4]]) usados[h].set(j, (usados[h].get(j) ?? 0) + 1);

  const te = m.lluvia ? filas(m, lluviaEcmwf, PRUEBA_ECMWF, fecha) : filas(m, null, PRUEBA_BASE, fecha);
  const antes = te.map((f) => ({ e: f.crudo - f.real, f }));
  const ahora = te.map((f) => ({ e: f.crudo + sumarArboles(arboles, f.x) - f.real, f }));
  const vieja: Tabla = { bandas: BANDAS_MEDIO[h], sesgos: SESGOS_MEDIO[h] };
  tablas[h] = medirTabla(ahora);
  const a = publicado(antes, vieja);
  const b = publicado(ahora, tablas[h]);
  const oct = (fs: { e: number; f: Fila }[], t: Tabla) => {
    const xs = fs.filter((x) => x.f.d >= '2026-10-01' && x.f.d <= '2026-10-31');
    return xs.length ? publicado(xs, t).mae.toFixed(3) : '—';
  };
  lineas.push(
    `| ${h} | ${te.length} | ${mae(antes.map((x) => x.e)).toFixed(3)} → ${mae(ahora.map((x) => x.e)).toFixed(3)} | ${a.mae.toFixed(3)} | ${b.mae.toFixed(3)} | ${pct(a.mae, b.mae)} | ` +
      `${Math.round(a.ancho * 100)} → ${Math.round(b.ancho * 100)} cm | ${Math.round(a.cubre * 100)} → ${Math.round(b.cubre * 100)} % | ${oct(antes, vieja)} → ${oct(ahora, tablas[h])} |`,
  );

  // Con el automático de Rosario, a 3 y 5 días.
  if (m.auto && conAuto) {
    const coef = m.auto.coef;
    const crudoAuto = (d: string) => {
      const x = predictores(series, d, m);
      const delta = cambioAutomatico(conAuto, d);
      return x && delta !== null ? [...x, delta].reduce((s, v, i) => s + v * coef[i], 0) : null;
    };
    const ta = filas(m, null, PRUEBA_BASE, fecha, crudoAuto);
    const a0 = ta.map((f) => ({ e: f.crudo - f.real, f }));
    const a1 = ta.map((f) => ({ e: f.crudo + sumarArboles(arboles, f.x) - f.real, f }));
    tablasAuto[h] = medirTabla(a1);
    const p0 = publicado(a0, { bandas: m.auto.bandas, sesgos: m.auto.sesgos });
    const p1 = publicado(a1, tablasAuto[h]);
    autoLineas.push(`| ${h} | ${ta.length} | ${mae(a0.map((x) => x.e)).toFixed(3)} → ${mae(a1.map((x) => x.e)).toFixed(3)} | ${p0.mae.toFixed(3)} | ${p1.mae.toFixed(3)} | ${pct(p0.mae, p1.mae)} | ${Math.round(p0.ancho * 100)} → ${Math.round(p1.ancho * 100)} cm | ${Math.round(p0.cubre * 100)} → ${Math.round(p1.cubre * 100)} % |`);
  }
}

console.log('## Validación (ajuste 2005-2015, medición 2016-2021, regresión sola)\n');
console.log('| Días | n | Error sin | Error con | Cambio |\n|---|---|---|---|---|');
console.log(validacion.join('\n'));
console.log(`\n## Lo publicado (ajuste 2005-2021; 3 y 5 días desde ${PRUEBA_BASE}, 7 y 10 desde ${PRUEBA_ECMWF} con ECMWF)\n`);
console.log('| Días | n | Regresión sola | Publicado antes | Publicado ahora | Cambio | Banda | Cubre | Crecida oct-26 |\n|---|---|---|---|---|---|---|---|---|');
console.log(lineas.join('\n'));
if (autoLineas.length) {
  console.log(`\n## Con el automático de Rosario (desde ${PRUEBA_BASE})\n`);
  console.log('| Días | n | Regresión sola | Publicado antes | Publicado ahora | Cambio | Banda | Cubre |\n|---|---|---|---|---|---|---|---|');
  console.log(autoLineas.join('\n'));
} else console.log('\nFalta .cache/automaticos/: correr `npm run ajuste-auto` para medir la variante con automático.');

console.log('\n## En qué se fija (veces que cada predictor aparece en una pregunta)\n');
for (const h of HORIZONTES) {
  const top = [...usados[h]].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([j, n]) => `${NOMBRES_CORRECCION[j]} ${n}`);
  console.log(`- ${h} días: ${top.join(', ')}`);
}

const bloque = (t: Record<number, Tabla>, k: 'bandas' | 'sesgos') => JSON.stringify(Object.fromEntries(Object.entries(t).map(([h, v]) => [h, v[k]])));
console.log(`\nBANDAS_CORREGIDO ${bloque(tablas, 'bandas')}\nSESGOS_CORREGIDO ${bloque(tablas, 'sesgos')}`);
if (autoLineas.length) console.log(`BANDAS_CORREGIDO_AUTO ${bloque(tablasAuto, 'bandas')}\nSESGOS_CORREGIDO_AUTO ${bloque(tablasAuto, 'sesgos')}`);

if (!probar) {
  const cuerpo = Object.entries(todos)
    .map(([h, as]) => `  ${h}: [\n${as.map((t) => `    ${JSON.stringify(t)},`).join('\n')}\n  ],`)
    .join('\n');
  writeFileSync(
    join(__dirname, '..', 'src', 'lib', 'correccion-rio-datos.ts'),
    `// Generado por \`npm run ajuste-correccion\` con datos hasta ${fecha}. No editar a mano.\nimport type { Arbol } from './correccion-rio';\n\nexport const ARBOLES_CORRECCION: Record<number, Arbol[]> = {\n${cuerpo}\n};\n`,
  );
  console.log('\nEscrito src/lib/correccion-rio-datos.ts');
}
