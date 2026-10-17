/**
 * Serie histórica de altura de cada estación, de la API abierta del INA.
 *
 * El cuadro de Prefectura (ver `rio.ts`) da la foto de hoy de toda la cuenca
 * en un pedido, que es lo que sirve para mostrar. Esto es lo otro: la historia
 * de UNA estación, que es lo que hace falta para decir "subió 30 cm en tres
 * días". Las dos fuentes coinciden en el dato del día, así que se validan sola.
 *
 * `alerta.ina.gob.ar/a5` responde JSON sin clave y tiene series diarias desde
 * el año 2000.
 */
export interface Observacion {
  /** YYYY-MM-DD. */
  dia: string;
  metros: number;
}

export interface EstacionRio {
  slug: string;
  nombre: string;
  /** Id de la serie de altura hidrométrica por medición directa en el INA. */
  serie: number;
  /** Umbral de alerta de Prefectura, en metros. */
  alerta: number | null;
  /** Posición en el río: menor = más arriba. */
  orden: number;
  /** Dónde está el hidrómetro, para buscar el más cercano a un lugar. */
  lat: number;
  lon: number;
}

/**
 * Tramo argentino del Paraná, de Corrientes al Delta. El orden es geográfico
 * y es el que le da sentido a "río arriba".
 *
 * San Lorenzo queda afuera: el INA no publica una serie de altura en metros
 * para esa estación, aunque sí aparece en el cuadro de Prefectura.
 */
export const ESTACIONES: EstacionRio[] = [
  { slug: 'corrientes', nombre: 'Corrientes', serie: 19, alerta: 6.5, orden: 0 , lat: -27.463, lon: -58.839 },
  { slug: 'barranqueras', nombre: 'Barranqueras', serie: 20, alerta: 6.0, orden: 1 , lat: -27.482, lon: -58.935 },
  { slug: 'bella-vista', nombre: 'Bella Vista', serie: 22, alerta: 6.0, orden: 2 , lat: -28.509, lon: -59.044 },
  { slug: 'goya', nombre: 'Goya', serie: 23, alerta: 5.2, orden: 3 , lat: -29.143, lon: -59.264 },
  { slug: 'reconquista', nombre: 'Reconquista', serie: 24, alerta: 5.1, orden: 4 , lat: -29.232, lon: -59.595 },
  { slug: 'esquina', nombre: 'Esquina', serie: 25, alerta: 5.0, orden: 5 , lat: -30.014, lon: -59.528 },
  { slug: 'la-paz', nombre: 'La Paz', serie: 26, alerta: 5.8, orden: 6 , lat: -30.742, lon: -59.645 },
  { slug: 'santa-elena', nombre: 'Santa Elena', serie: 27, alerta: 6.9, orden: 7 , lat: -30.948, lon: -59.788 },
  { slug: 'hernandarias', nombre: 'Hernandarias', serie: 28, alerta: 5.5, orden: 8 , lat: -31.231, lon: -59.985 },
  { slug: 'parana', nombre: 'Paraná', serie: 29, alerta: 4.7, orden: 9 , lat: -31.72, lon: -60.53 },
  { slug: 'santa-fe', nombre: 'Santa Fe', serie: 30, alerta: 5.3, orden: 10 , lat: -31.652, lon: -60.702 },
  { slug: 'diamante', nombre: 'Diamante', serie: 31, alerta: 5.3, orden: 11 , lat: -32.066, lon: -60.642 },
  { slug: 'victoria', nombre: 'Victoria', serie: 32, alerta: 4.6, orden: 12 , lat: -32.62, lon: -60.155 },
  { slug: 'rosario', nombre: 'Rosario', serie: 34, alerta: 5.0, orden: 13 , lat: -32.945, lon: -60.63 },
  { slug: 'villa-constitucion', nombre: 'Villa Constitución', serie: 35, alerta: 4.0, orden: 14 , lat: -33.231, lon: -60.327 },
  { slug: 'san-nicolas', nombre: 'San Nicolás', serie: 36, alerta: 4.2, orden: 15 , lat: -33.333, lon: -60.213 },
  { slug: 'ramallo', nombre: 'Ramallo', serie: 37, alerta: 3.5, orden: 16 , lat: -33.487, lon: -60.003 },
  { slug: 'san-pedro', nombre: 'San Pedro', serie: 38, alerta: 3.4, orden: 17 , lat: -33.677, lon: -59.656 },
  { slug: 'baradero', nombre: 'Baradero', serie: 39, alerta: null, orden: 18 , lat: -33.806, lon: -59.502 },
];

export const estacionRio = (slug: string) => ESTACIONES.find((e) => e.slug === slug) ?? null;

interface RespuestaINA {
  observaciones?: { timestart?: string; valor?: number | string | null }[];
}

/** Observaciones diarias de una estación entre dos fechas (YYYY-MM-DD). */
export async function traerSerie(serie: number, desde: string, hasta: string): Promise<Observacion[]> {
  const url = `https://alerta.ina.gob.ar/a5/obs/puntual/series/${serie}?timestart=${desde}&timeend=${hasta}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; modelo-y/1.0; +https://github.com/luc-io/modelo-y)' },
  });
  if (!res.ok) throw new Error(`INA respondió ${res.status} para la serie ${serie}`);

  const d = (await res.json()) as RespuestaINA;
  return (d.observaciones ?? [])
    .map((o) => ({ dia: String(o.timestart ?? '').slice(0, 10), metros: Number(o.valor) }))
    .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.dia) && Number.isFinite(o.metros))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Resta días a una fecha YYYY-MM-DD sin pasar por zonas horarias. */
export function menosDias(dia: string, n: number): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

export interface Variacion {
  /** La última lectura disponible. */
  hoy: Observacion;
  /** La lectura contra la que se compara. */
  antes: Observacion;
  /** Metros de diferencia: positivo si creció. */
  metros: number;
  /** Días reales entre las dos lecturas, que pueden no ser los pedidos. */
  diasReales: number;
}

/**
 * Cuánto cambió la altura en los últimos `dias`.
 *
 * Los hidrómetros tienen huecos —días sin lectura, feriados, crecidas que
 * impiden medir— así que se busca la observación más cercana a la fecha
 * objetivo en vez de contar posiciones hacia atrás en el arreglo. Devuelve
 * `null` si no hay con qué comparar.
 */
export function variacionEn(serie: Observacion[], dias: number): Variacion | null {
  if (serie.length < 2) return null;
  const hoy = serie[serie.length - 1];
  const objetivo = menosDias(hoy.dia, dias);

  const candidatas = serie.slice(0, -1);
  if (candidatas.length === 0) return null;

  const distancia = (o: Observacion) => Math.abs(Date.parse(o.dia) - Date.parse(objetivo));
  const antes = candidatas.reduce((mejor, o) => (distancia(o) < distancia(mejor) ? o : mejor));

  const diasReales = Math.round((Date.parse(hoy.dia) - Date.parse(antes.dia)) / 86_400_000);
  // Una comparación contra una lectura de hace el doble de tiempo no responde
  // la pregunta que se hizo, así que es mejor no contestar.
  if (diasReales < 1 || diasReales > dias * 2) return null;

  return { hoy, antes, metros: Number((hoy.metros - antes.metros).toFixed(2)), diasReales };
}
