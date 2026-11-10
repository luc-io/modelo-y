import type { Observacion } from './rio-historia';
import { menosDias } from './rio-historia';
import type { LluviaTramo } from './lluvia-tramo';

/**
 * Pronóstico propio de altura para Rosario.
 *
 * NO es el pronóstico oficial. El INA publica el suyo con un modelo
 * hidrodinámico calibrado; esto es una regresión con retardos ajustada sobre
 * datos abiertos, y por eso siempre se muestra con su banda de error medida. Un número
 * sin margen invita a decidir con una precisión que no tiene, y acá la gente
 * mueve amarras.
 *
 * Cómo funciona: el agua tarda un tiempo conocido en bajar de cada estación a
 * Rosario —14 días desde Corrientes, 3 desde Paraná— así que la altura de hoy
 * río arriba ya contiene la de mañana acá. Los retardos salen de maximizar la
 * correlación sobre diez años; las correlaciones dan entre 0,93 y 0,99.
 * Cada horizonte mira las cinco estaciones (`ESTACIONES_Y`): las que todavía
 * no mandaron su agua, del día en que la mandan; las que ya la mandaron, con
 * su dato de hoy, que dice si la onda ya pasó por ahí.
 *
 * Ajustado con 2005-2021 y medido contra 2022-2026, un período que no vio y
 * que incluye la bajante histórica. Le gana a la persistencia por 21-32%.
 */
export interface ModeloRio {
  horizonte: number;
  /**
   * Estaciones que mira. Las de retardo menor que el horizonte entran con su
   * dato de hoy (ver `predictores`).
   */
  usa: string[];
  /** Ordenada, coeficiente de la altura propia, y por estación: nivel y tendencia a 3 días. */
  coef: number[];
  /** Error absoluto medio en 2022-2026, en metros. La banda que se muestra es `BANDAS`. */
  mae: number;
  /**
   * Suma la lluvia del tramo argentino (ver `lluvia-tramo.ts`): la de los 7
   * días previos y la pronosticada hasta el día del horizonte. Sus bandas y
   * sesgos son `BANDAS_LLUVIA` y `SESGOS_LLUVIA`, y su `mae` está medido con
   * el pronóstico real de ECMWF desde febrero de 2024.
   */
  lluvia?: true;
  /**
   * Suma lo que suelta Yacyretá (caudal efluente, `SERIE_YACYRETA`): cuánto
   * cambió en los últimos 3 días, en decenas de miles de m³/s. Esa agua pasa
   * por Corrientes días después, así que deja ver la onda antes y llegar a 17
   * días. Sólo el cambio y no el nivel: el nivel repite lo que ya dice
   * Corrientes y entraba con signo negativo, que con un dato de Corrientes
   * atrasado daba cualquier cosa; sin él se pierde 1 cm a 14 días. Sus bandas
   * y sesgos son `BANDAS_REPRESA` y `SESGOS_REPRESA`.
   */
  represa?: true;
  /** Suma las estaciones del medio (`ESTACIONES_MEDIO`). Sus bandas y sesgos son `BANDAS_MEDIO` y `SESGOS_MEDIO`. */
  medio?: true;
  /**
   * El gemelo «sólo variaciones»: coeficientes que pronostican cuánto va a
   * cambiar Rosario mirando sólo cómo vienen cambiando las estaciones, sin
   * sus alturas (ver `predictoresCambio`). Desde 7 días el número es la mezcla
   * de los dos (`PESO_ALTURA`).
   */
  cambios?: number[];
  /**
   * La variante que arranca Rosario desde el hidrómetro automático, a 3 y 5
   * días: los mismos predictores más `cambioAutomatico`, con su error, bandas
   * y sesgos (2022-2026, con el automático de verdad). Sale cuando hay
   * automático; si no, el modelo de siempre. Ver `SERIE_AUTO`.
   */
  auto?: { coef: number[]; mae: number; bandas: Record<Regimen, [number, number]>; sesgos: Record<Regimen, number> };
}

/**
 * Clave en `series` del hidrómetro automático de Rosario, a un valor por día
 * (el de las 8, ver `automaticoDiario`) y en su propia escala.
 *
 * El cuadro de Prefectura con que corre el modelo es la lectura de la mañana
 * anterior; el automático ya tiene la de hoy. Con cuánto cambió entre las dos
 * como predictor, el error baja 15 % a 3 días (0,088 → 0,075 m con las del
 * medio) y 7 % a 5 (0,114 → 0,106) en 2022-2026; a 7 días, 2 %, y desde 10
 * nada, así que entra sólo a 3 y 5. Lo mismo con los automáticos de Paraná y
 * La Paz no mejoró (0 a +2 %). `npm run ajuste-auto`.
 */
export const SERIE_AUTO = 'rosario-auto';

/** Un cambio mayor en un día no es el río: es el sensor. Ahí sale el modelo de siempre. */
const SALTO_AUTO = 0.6;

/**
 * Cuánto cambió el automático de Rosario entre las 8 del día anterior a `hoy`
 * y las 8 de `hoy`, en metros: lo que subió o bajó el río desde la lectura
 * de Prefectura fechada `hoy`, que es de la mañana anterior. Null si falta
 * alguna de las dos o el salto no es creíble.
 */
export function cambioAutomatico(series: Record<string, Observacion[]>, hoy: string): number | null {
  const s = series[SERIE_AUTO] ?? [];
  const ahora = enDia(s, hoy);
  const antes = enDia(s, menosDias(hoy, 1));
  if (ahora === null || antes === null || Math.abs(ahora - antes) > SALTO_AUTO) return null;
  return ahora - antes;
}

/**
 * Cuánto pesa el modelo con alturas en la mezcla con el de sólo variaciones,
 * desde 7 días. Las alturas dicen hacia dónde tiende Rosario (con Corrientes
 * alta y Rosario bajo, falta agua por llegar); las variaciones, la forma de
 * la onda. Solas, las alturas sobreajustan: ajustando con 2005-2015, en
 * 2016-2021 la mezcla mitad y mitad erra 3-4 % menos que las alturas solas a
 * 7 y 10 días, 4-5 % a 14 y 7 % a 17 (con Yacyretá, 0,247 → 0,230 m), y
 * 0,5 es el mejor peso en todos los modelos. En 2022-2026 empatan, y con
 * ECMWF desde 2024 la mezcla pierde 1-2 % (`npm run ajuste-modelo-y`). En
 * noviembre de 2026, con Corrientes en 7 m y Rosario en 4,06, el de alturas
 * seguía subiendo a 14 y 17 días y el de variaciones se aplanaba.
 */
export const PESO_ALTURA = 0.5;

/** Serie del INA con el caudal efluente de Yacyretá, en m³/s. Va en `series` con la clave `yacyreta`. */
export const SERIE_YACYRETA = 937;

/**
 * Las cinco estaciones que mira el Modelo Y en todos los horizontes. Hasta el
 * 6/11/2026 cada horizonte miraba sólo las que todavía no habían mandado su
 * agua (a 14 días, sólo Corrientes) y no veía cómo estaban hoy las de abajo:
 * en la crecida de octubre-noviembre de 2026 el pico ya había pasado Goya y
 * Reconquista y el escenario a 14 días seguía subiendo. Con las cinco en
 * todos, lo publicado erra 16 % menos a 7 días (0,176 → 0,147 m en
 * 2022-2026), 5-9 % menos a 10 y 14, y 5-7 % menos a 14 y 17 con Yacyretá;
 * las bandas se angostan (a 7 días, de 57 a 47 cm) y siguen cubriendo el 80 %
 * (`npm run ajuste-modelo-y`).
 */
export const ESTACIONES_Y = ['corrientes', 'goya', 'reconquista', 'la-paz', 'parana'];

/**
 * Las del medio del tramo, que tienen hoy el agua que llega a Rosario en 5 a
 * 12 días. Entran de 3 a 10 días (`MODELOS_MEDIO`), que es donde mejoran; si
 * alguna no informó, sale el modelo de las cinco. Hernandarias no: tiene
 * huecos de días seguidos.
 *
 * Entran con su dato de hoy, o casi: con el retardo de sus cambios
 * (`RETARDOS_CAMBIO`) y no con el del agua. Con el del agua sólo mejoraban a
 * 5 días; con el de los cambios, 5 % a 3 días, 13 % a 5, 9 % a 7 y 3 % a 10.
 */
export const ESTACIONES_MEDIO = ['bella-vista', 'esquina', 'santa-elena'];

/**
 * Para las estaciones del medio, cuántos días tarda en notarse en Rosario un
 * cambio de la estación: el que maximiza la correlación entre su cambio en 3
 * días y el de Rosario después, en 2005-2021 (`npm run estaciones-medias`).
 * Es más corto que el viaje del agua (`RETARDOS`), que sigue siendo el que se
 * muestra.
 */
export const RETARDOS_CAMBIO: Record<string, number> = { 'bella-vista': 6, 'esquina': 4, 'santa-elena': 3 };

/**
 * Días que tarda el agua en llegar de cada estación a Rosario. Los de las
 * estaciones del medio, medidos el 6/11/2026 igual que los otros (máxima
 * correlación de alturas en 2005-2021) y llevados a la misma escala: con ese
 * método Corrientes da 16 y Paraná 4, uno o dos más que los de siempre.
 */
export const RETARDOS: Record<string, number> = {
  'corrientes': 14,
  'bella-vista': 12,
  'goya': 11,
  'reconquista': 10,
  'esquina': 8,
  'la-paz': 6,
  'santa-elena': 5,
  'parana': 3,
  'santa-fe': 2,
  'diamante': 2,
};

export const MODELOS: ModeloRio[] = [
  {
    horizonte: 3,
    usa: ESTACIONES_Y,
    coef: [0.046196, 0.75075, -0.028231, 0.010896, 0.062123, 0.003521, -0.119314, 0.025339, 0.032222, -0.04857, 0.28709, 0.486561],
    mae: 0.103,
    auto: { coef: [0.032288, 0.825532, -0.019843, 0.004993, 0.047995, 0.0039, -0.083048, 0.024005, 0.018039, -0.043864, 0.200796, 0.35503, 0.859231], mae: 0.082, bandas: { sube: [-0.1, 0.11], baja: [-0.1, 0.14], resto: [-0.12, 0.14] }, sesgos: { sube: 0.01, baja: 0.04, resto: 0.03 } },
  },
  {
    horizonte: 5,
    usa: ESTACIONES_Y,
    coef: [0.030799, 0.660227, -0.015468, 0.040013, 0.026106, 0.036702, -0.102337, -0.075409, 0.088084, 0.169382, 0.320676, 0.483087],
    mae: 0.142,
    auto: { coef: [0.016892, 0.722146, -0.012138, 0.035587, 0.016119, 0.04346, -0.06573, -0.093007, 0.072571, 0.182475, 0.249921, 0.369911, 0.699223], mae: 0.13, bandas: { sube: [-0.2, 0.13], baja: [-0.11, 0.28], resto: [-0.21, 0.22] }, sesgos: { sube: -0.03, baja: 0.08, resto: 0.05 } },
  },
  {
    horizonte: 7,
    usa: ESTACIONES_Y,
    coef: [-0.016194, 0.5971, -0.012741, 0.059845, -0.046169, 0.0018, -0.01531, -0.164714, 0.161788, 0.498532, 0.292385, 0.3807],
    cambios: [-0.001653, 0.04867, 0.005684, 0.001985, -0.042616, -0.120264, -0.065721, 0.583655, 0.041396, 0.225346, 0.480528, -0.289686],
    mae: 0.16,
  },
  {
    horizonte: 10,
    usa: ESTACIONES_Y,
    coef: [-0.239791, 0.603891, -0.169427, -0.041092, 0.097652, -0.04322, 0.314312, 0.330792, 0.015057, 0.209874, 0.194409, 0.611225],
    cambios: [-0.002916, -0.050694, -0.091289, 0.018356, -0.013634, 0.414506, 0.187073, 0.295468, -0.019258, 0.401756, 0.483842, -0.261215],
    mae: 0.193,
  },
  {
    horizonte: 14,
    usa: ESTACIONES_Y,
    coef: [-0.246787, 0.505515, -0.093066, 0.432681, 0.079908, 0.076666, 0.330948, 0.035096, 0.01371, 0.337904, 0.207903, 0.574011],
    cambios: [-0.004698, 0.414477, -0.073384, 0.207859, -0.106124, 0.075581, 0.303076, 0.465239, -0.093104, 0.507243, 0.613027, -0.414946],
    mae: 0.246,
  },
];

/**
 * Los mismos horizontes desde 7 días, con la lluvia del tramo argentino. A 3
 * y 5 días no mejora: el agua de los afluentes todavía no llegó. Ajustados con
 * 2005-2021 usando la lluvia que cayó (ERA5) y medidos con lo que de verdad
 * se pronosticaba (ECMWF, febrero de 2024 en adelante), con
 * `npm run ajuste-lluvia-rio`.
 */
export const MODELOS_LLUVIA: ModeloRio[] = [
  {
    horizonte: 7,
    usa: ESTACIONES_Y,
    coef: [-0.106958, 0.59173, -0.039779, 0.074167, 0.007624, -0.017328, -0.006348, -0.16141, 0.165696, 0.486203, 0.258602, 0.303691, 0.061254, 0.193709],
    cambios: [-0.045839, 0.04927, 0.01288, -0.00233, -0.031239, -0.115286, -0.074336, 0.585194, 0.037653, 0.212857, 0.466979, -0.290079, 0.009703, 0.181549],
    mae: 0.158,
    lluvia: true,
  },
  {
    horizonte: 10,
    usa: ESTACIONES_Y,
    coef: [-0.376355, 0.597496, -0.187043, -0.005447, 0.171323, -0.08308, 0.291105, 0.29188, 0.027321, 0.186263, 0.149119, 0.501705, 0.078779, 0.271623],
    cambios: [-0.084846, -0.051511, -0.072521, 0.014458, -0.018997, 0.411184, 0.174722, 0.294889, -0.016375, 0.384644, 0.465752, -0.258713, -0.005068, 0.251821],
    mae: 0.18,
    lluvia: true,
  },
  {
    horizonte: 14,
    usa: ESTACIONES_Y,
    coef: [-0.442224, 0.507814, -0.105793, 0.420922, 0.169251, 0.029305, 0.289684, 0.017585, 0.027126, 0.331547, 0.146458, 0.438322, 0.096553, 0.314105],
    cambios: [-0.139659, 0.39771, -0.05632, 0.203933, -0.122323, 0.060926, 0.303771, 0.451061, -0.066435, 0.483438, 0.576014, -0.409797, -0.021253, 0.302364],
    mae: 0.226,
    lluvia: true,
  },
];

/**
 * Con la lluvia del tramo y Yacyretá: 14 días, y 17, que sin Yacyretá no se
 * puede. A 7 y 10 días Yacyretá no mejora de forma pareja entre períodos, así
 * que ahí queda sólo la lluvia. Ajustados y medidos como `MODELOS_LLUVIA`,
 * con `npm run ajuste-lluvia-rio`. A 17 días ninguna estación alcanza: usa
 * Corrientes de hoy.
 */
export const MODELOS_REPRESA: ModeloRio[] = [
  {
    horizonte: 14,
    usa: ESTACIONES_Y,
    coef: [-0.427117, 0.515259, -0.068969, 0.421007, 0.145103, 0.053891, 0.291161, 0.010761, 0.004617, 0.30194, 0.150146, 0.481035, 0.342508, 0.076986, 0.304402],
    cambios: [-0.133948, 0.390251, -0.022712, 0.233189, -0.161959, 0.036837, 0.349755, 0.409828, -0.096954, 0.487626, 0.610626, -0.411656, 0.328107, -0.036368, 0.301055],
    mae: 0.215,
    lluvia: true,
    represa: true,
  },
  {
    horizonte: 17,
    usa: ESTACIONES_Y,
    coef: [-0.527412, 0.492203, -0.047764, 0.458631, 0.162187, 0.019166, 0.370453, -0.000313, -0.016308, 0.315319, 0.079604, 0.404752, 0.440309, 0.091988, 0.337278],
    cambios: [-0.18218, 0.441934, -0.010416, 0.27774, -0.274011, 0.003981, 0.530215, 0.409062, -0.112988, 0.460047, 0.683805, -0.532954, 0.423918, -0.051977, 0.337806],
    mae: 0.264,
    lluvia: true,
    represa: true,
  },
];

/**
 * Percentiles 10 y 90 del error (pronosticado - real), en metros, por
 * horizonte y por régimen de Corrientes: entre los dos queda lo real 8 de cada
 * 10 veces. Reemplazan al ± del error absoluto medio, que era simétrico y
 * escondía que con Corrientes en crecida el modelo se queda corto (sesgo -18
 * cm a 7 días) y en bajante se pasa (+8 a +12 cm).
 *
 * Medidos con `npm run ajuste-modelo-y` el 6/11/2026 (antes, `npm run
 * margen-rio`, el 12/10/2026),
 * día por día de 2022 a 2026, que el ajuste no vio y que incluye la bajante
 * histórica: entre 456 y 720 pronósticos por casilla. En 2005-2021 el patrón
 * es el mismo pero más angosto, porque es la muestra con que se ajustó; usar
 * esa daría una banda optimista.
 */
export const BANDAS: Record<number, Record<Regimen, [number, number]>> = {
  3: { sube: [-0.13, 0.14], baja: [-0.12, 0.18], resto: [-0.13, 0.18] },
  5: { sube: [-0.23, 0.17], baja: [-0.12, 0.28], resto: [-0.21, 0.26] },
  7: { sube: [-0.33, 0.12], baja: [-0.12, 0.34], resto: [-0.26, 0.24] },
  10: { sube: [-0.4, 0.23], baja: [-0.21, 0.37], resto: [-0.36, 0.3] },
  14: { sube: [-0.41, 0.34], baja: [-0.34, 0.46], resto: [-0.46, 0.38] },
};

/**
 * Mediana del error (pronosticado - real), en metros, por horizonte y por
 * régimen de Corrientes: lo que la regresión se pasa (positivo) o se queda
 * corta (negativo) la mitad de las veces. `predecir` se la resta al número
 * central, que sin esto quedaba en un costado de su propia banda: con
 * Corrientes en crecida, 16 cm abajo a 7 días, y la línea "caía" al empalmar
 * con el pronóstico del INA. La mediana y no el promedio, por lo mismo que la
 * banda: los errores tienen cola y la cola no tiene que mover el centro.
 *
 * Medidas con `npm run ajuste-modelo-y` el 6/11/2026 sobre los mismos datos y
 * período que `BANDAS` (2022-2026, fuera del ajuste). En 2005-2021 el sesgo
 * apunta para el mismo lado pero es la mitad o menos. El de «sube», sólo en la
 * primera semana de la subida, que es donde se aplica (`SUBE_SEMANA`).
 */
export const SESGOS: Record<number, Record<Regimen, number>> = {
  3: { sube: 0.03, baja: 0.05, resto: 0.04 },
  5: { sube: -0.02, baja: 0.09, resto: 0.05 },
  7: { sube: -0.1, baja: 0.1, resto: 0.02 },
  10: { sube: -0.08, baja: 0.05, resto: 0 },
  14: { sube: -0.05, baja: 0.02, resto: -0.01 },
};

/** Como `BANDAS`, para `MODELOS_LLUVIA`, medidas con el pronóstico de ECMWF desde 2024-02-15. */
export const BANDAS_LLUVIA: Record<number, Record<Regimen, [number, number]>> = {
  7: { sube: [-0.3, 0.1], baja: [-0.09, 0.36], resto: [-0.22, 0.24] },
  10: { sube: [-0.33, 0.19], baja: [-0.19, 0.35], resto: [-0.32, 0.27] },
  14: { sube: [-0.4, 0.34], baja: [-0.32, 0.43], resto: [-0.38, 0.36] },
};

/** Como `SESGOS`, para `MODELOS_LLUVIA`, sobre los mismos días que `BANDAS_LLUVIA`. */
export const SESGOS_LLUVIA: Record<number, Record<Regimen, number>> = {
  7: { sube: -0.09, baja: 0.13, resto: 0.03 },
  10: { sube: -0.07, baja: 0.07, resto: 0.02 },
  14: { sube: -0.04, baja: 0.03, resto: 0.02 },
};

/** Como `BANDAS_LLUVIA`, para `MODELOS_REPRESA`. */
export const BANDAS_REPRESA: Record<number, Record<Regimen, [number, number]>> = {
  14: { sube: [-0.37, 0.34], baja: [-0.27, 0.42], resto: [-0.4, 0.32] },
  17: { sube: [-0.43, 0.44], baja: [-0.38, 0.44], resto: [-0.47, 0.38] },
};

/** Como `SESGOS_LLUVIA`, para `MODELOS_REPRESA`. */
export const SESGOS_REPRESA: Record<number, Record<Regimen, number>> = {
  14: { sube: -0.06, baja: 0.05, resto: 0.01 },
  17: { sube: -0.04, baja: 0.04, resto: 0 },
};

/**
 * Con las estaciones del medio (`ESTACIONES_MEDIO`) además de las cinco: a 3
 * y 5 días sin lluvia, a 7 y 10 con lluvia. Ajustados en 2005-2021 y medidos
 * como los otros, con `npm run ajuste-modelo-y`.
 */
export const MODELOS_MEDIO: ModeloRio[] = [
  {
    horizonte: 3,
    usa: [...ESTACIONES_Y, ...ESTACIONES_MEDIO],
    coef: [-0.056921, 0.752537, -0.015369, 0.004766, 0.042659, 0.010126, -0.093609, 0.02497, -0.009814, -0.022613, 0.212606, 0.317814, -0.04186, 0.000471, -0.001701, -0.024307, 0.145469, 0.137558],
    mae: 0.09,
    medio: true,
    auto: { coef: [-0.058029, 0.826745, -0.008719, -0.001209, 0.030786, 0.010177, -0.057558, 0.024871, -0.016702, -0.01925, 0.135816, 0.189813, -0.034465, 0.008399, -0.003862, -0.015899, 0.123231, 0.126756, 0.848574], mae: 0.075, bandas: { sube: [-0.12, 0.1], baja: [-0.1, 0.13], resto: [-0.13, 0.12] }, sesgos: { sube: 0, baja: 0.02, resto: 0.02 } },
  },
  {
    horizonte: 5,
    usa: [...ESTACIONES_Y, ...ESTACIONES_MEDIO],
    coef: [-0.127893, 0.665138, -0.007469, 0.008402, 0.039265, 0.038659, -0.07631, 0.022695, -0.053269, 0.004492, 0.22602, 0.408555, -0.066566, 0.193589, 0.063909, 0.004397, 0.210338, 0.093013],
    mae: 0.113,
    medio: true,
    auto: { coef: [-0.129431, 0.726911, -0.006277, 0.004152, 0.028945, 0.045754, -0.041498, 0.002561, -0.063262, 0.013535, 0.162725, 0.29583, -0.060104, 0.187723, 0.068236, 0.006785, 0.19062, 0.093135, 0.700495], mae: 0.106, bandas: { sube: [-0.19, 0.1], baja: [-0.12, 0.21], resto: [-0.19, 0.15] }, sesgos: { sube: -0.04, baja: 0.05, resto: 0.01 } },
  },
  {
    horizonte: 7,
    usa: [...ESTACIONES_Y, ...ESTACIONES_MEDIO],
    coef: [-0.254962, 0.601554, -0.036858, 0.035546, 0.039203, 0.008657, -0.039414, -0.054275, -0.074492, 0.239829, 0.172396, 0.409884, -0.038703, 0.280604, 0.13626, -0.05314, 0.247134, 0.025343, 0.039775, 0.194171],
    cambios: [-0.040493, 0.046515, 0.002246, 0.031475, -0.017962, -0.054097, -0.02254, 0.185552, 0.081917, 0.305868, 0.482972, 0.296904, -0.052695, 0.013947, 0.021784, 0.244469, -0.111529, -0.288376, -0.013518, 0.181358],
    mae: 0.131,
    lluvia: true,
    medio: true,
  },
  {
    horizonte: 10,
    usa: [...ESTACIONES_Y, ...ESTACIONES_MEDIO],
    coef: [-0.414726, 0.585051, -0.139758, 0.009998, 0.065334, -0.119241, 0.112633, 0.001331, -0.181995, 0.326959, 0.072047, 0.454779, 0.04124, 0.307732, 0.241273, -0.069005, 0.247678, 0.012098, 0.069424, 0.275439],
    cambios: [-0.083714, -0.037762, -0.043932, -0.087069, -0.030461, 0.046012, 0.117981, 0.262304, -0.000975, 0.326581, 0.514065, 0.350844, -0.009275, 0.023618, 0.074241, 0.268606, -0.108975, -0.268722, -0.02236, 0.257704],
    mae: 0.169,
    lluvia: true,
    medio: true,
  },
];

/** Como `BANDAS`, para `MODELOS_MEDIO` (3 y 5 días en 2022-2026; 7 y 10 con ECMWF desde 2024-02-15). */
export const BANDAS_MEDIO: Record<number, Record<Regimen, [number, number]>> = {
  3: { sube: [-0.13, 0.13], baja: [-0.11, 0.16], resto: [-0.13, 0.15] },
  5: { sube: [-0.21, 0.12], baja: [-0.12, 0.21], resto: [-0.18, 0.18] },
  7: { sube: [-0.22, 0.13], baja: [-0.16, 0.27], resto: [-0.21, 0.23] },
  10: { sube: [-0.27, 0.19], baja: [-0.21, 0.32], resto: [-0.32, 0.25] },
};

/** Como `SESGOS`, para `MODELOS_MEDIO`. */
export const SESGOS_MEDIO: Record<number, Record<Regimen, number>> = {
  3: { sube: 0.02, baja: 0.04, resto: 0.03 },
  5: { sube: -0.04, baja: 0.05, resto: 0.02 },
  7: { sube: -0.04, baja: 0.06, resto: 0.01 },
  10: { sube: -0.04, baja: 0.02, resto: 0 },
};

/** Las bandas y sesgos que corresponden a un modelo. */
function tablas(m: ModeloRio) {
  if (m.medio) return { bandas: BANDAS_MEDIO, sesgos: SESGOS_MEDIO };
  if (m.represa) return { bandas: BANDAS_REPRESA, sesgos: SESGOS_REPRESA };
  if (m.lluvia) return { bandas: BANDAS_LLUVIA, sesgos: SESGOS_LLUVIA };
  return { bandas: BANDAS, sesgos: SESGOS };
}

export interface Punto {
  /**
   * Día en que el río estaría a esa altura, a la mañana. El modelo predice el
   * número del cuadro de Prefectura, que sale fechado un día después de la
   * lectura (ver `automatico-ina.ts`); acá ya viene corregido.
   */
  dia: string;
  metros: number;
  /** Banda de error medida para ese horizonte y ese régimen, en metros. */
  min: number;
  max: number;
  /** Qué variante salió: con lluvia, con Yacyretá, con el automático o la base. Para guardar el histórico. */
  modelo?: 'base' | 'medio' | 'lluvia' | 'lluvia-medio' | 'represa' | 'base-auto' | 'medio-auto';
}

/**
 * Cómo viene Corrientes, que es lo que el modelo sigue peor. Cuando arriba
 * crece rápido, la regresión —lineal y ajustada mayormente con río tranquilo—
 * se queda corta; cuando baja, se pasa. Por eso la banda no es simétrica.
 */
export type Regimen = 'sube' | 'baja' | 'resto';
export const REGIMENES: Regimen[] = ['sube', 'baja', 'resto'];
/** Cambio de Corrientes en los 10 días previos que separa los regímenes, en metros. */
const SUBE = 0.4;
const BAJA = -0.15;

/**
 * Régimen según cuánto cambió Corrientes entre `hoy` y diez días antes. Tolera
 * un día de hueco en cada punta; si no hay con qué comparar, null.
 */
export function regimenCorrientes(s: Observacion[], hoy: string): Regimen | null {
  const c = cambioCorrientes(s, hoy);
  if (c === null) return null;
  return c > SUBE ? 'sube' : c < BAJA ? 'baja' : 'resto';
}

/** Cuánto cambió Corrientes entre `hoy` y diez días antes, en metros, con un día de hueco en cada punta. */
export function cambioCorrientes(s: Observacion[], hoy: string): number | null {
  const cerca = (dia: string) => enDia(s, dia) ?? enDia(s, menosDias(dia, 1));
  const ahora = cerca(hoy);
  const antes = cerca(menosDias(hoy, 10));
  return ahora === null || antes === null ? null : ahora - antes;
}

const enDia = (s: Observacion[], dia: string) => s.find((o) => o.dia === dia)?.metros ?? null;

/**
 * Cuánto puede quedar lo real por debajo y por encima de la regresión cruda.
 * Sin régimen (falta Corrientes), la más ancha de las tres: no saber cómo
 * viene el río arriba no es motivo para achicar el margen.
 */
function banda(b: Record<Regimen, [number, number]>, r: Regimen | null): [number, number] {
  if (r) return [-b[r][1], -b[r][0]];
  return [-Math.max(...REGIMENES.map((k) => b[k][1])), -Math.min(...REGIMENES.map((k) => b[k][0]))];
}

/**
 * La regresión sola, sin corregir el sesgo: es lo que mide
 * `scripts/margen-rio.ts`, porque `BANDAS` y `SESGOS` son errores de esto.
 * `series` son las observaciones por estación, `hoy` el último día con dato
 * de Rosario. Devuelve null si falta cualquier predictor: completar un hueco
 * con un supuesto sería inventar el pronóstico.
 */
export function regresion(
  series: Record<string, Observacion[]>,
  hoy: string,
  m: ModeloRio,
  lluvia?: LluviaTramo | null,
): number | null {
  const x = predictores(series, hoy, m, lluvia);
  if (x === null || x.length !== m.coef.length) return null;
  const conAlturas = m.coef.reduce((a, c, i) => a + c * x[i], 0);
  if (!m.cambios) return conAlturas;
  // Sin los datos del gemelo (le falta historia: el cambio en 10 días), el de alturas solo.
  const xc = predictoresCambio(series, hoy, m, lluvia);
  if (xc === null || xc.length !== m.cambios.length) return conAlturas;
  const conCambios = x[1] + m.cambios.reduce((a, c, i) => a + c * xc[i], 0);
  return PESO_ALTURA * conAlturas + (1 - PESO_ALTURA) * conCambios;
}

/**
 * Los predictores del gemelo «sólo variaciones», en el orden de `cambios`:
 * 1; por estación, cuánto cambió en 3 y en 10 días (del mismo día que mira
 * `predictores`); cuánto cambió Rosario en 7; y si el modelo los usa,
 * Yacyretá y la lluvia como en `predictores`. Pronostica el cambio de
 * Rosario, no su altura.
 */
export function predictoresCambio(
  series: Record<string, Observacion[]>,
  hoy: string,
  m: ModeloRio,
  lluvia?: LluviaTramo | null,
): number[] | null {
  const ros = series.rosario ?? [];
  const r = enDia(ros, hoy);
  const r7 = enDia(ros, menosDias(hoy, 7));
  if (r === null || r7 === null) return null;
  const x: number[] = [1];
  for (const k of m.usa) {
    const s = series[k];
    if (!s) return null;
    const dia = menosDias(hoy, Math.max(0, (RETARDOS_CAMBIO[k] ?? RETARDOS[k]) - m.horizonte));
    const n = enDia(s, dia);
    const a3 = enDia(s, menosDias(dia, 3));
    const a10 = enDia(s, menosDias(dia, 10));
    if (n === null || a3 === null || a10 === null) return null;
    x.push(n - a3, n - a10);
  }
  x.push(r - r7);
  if (m.represa) {
    const s = series.yacyreta ?? [];
    const ahora = enDia(s, hoy);
    const antes = enDia(s, menosDias(hoy, 3));
    if (ahora === null || antes === null) return null;
    x.push((ahora - antes) / 10_000);
  }
  if (m.lluvia) {
    const pasada = lluvia?.pasada(hoy) ?? null;
    const futura = lluvia?.futura(hoy, m.horizonte) ?? null;
    if (pasada === null || futura === null) return null;
    x.push(pasada / 100, futura / 100);
  }
  return x;
}

/**
 * Los predictores de un modelo en el orden de `coef`: 1, la altura de
 * Rosario y, por estación, nivel y cambio en 3 días; si el modelo usa lluvia,
 * la pasada y la futura del tramo, en decenas de mm. Lo usa también el ajuste
 * (`scripts/ajuste-lluvia-rio.ts`), para que los coeficientes y la página no
 * puedan armar la fila distinto.
 */
export function predictores(
  series: Record<string, Observacion[]>,
  hoy: string,
  m: ModeloRio,
  lluvia?: LluviaTramo | null,
): number[] | null {
  const propio = enDia(series.rosario ?? [], hoy);
  if (propio === null) return null;

  const x: number[] = [1, propio];
  for (const k of m.usa) {
    const s = series[k];
    if (!s) return null;
    // Más allá del retraso de la estación (17 días desde Corrientes), su dato de hoy.
    const dia = menosDias(hoy, Math.max(0, (RETARDOS_CAMBIO[k] ?? RETARDOS[k]) - m.horizonte));
    const nivel = enDia(s, dia);
    const antes = enDia(s, menosDias(dia, 3));
    if (nivel === null || antes === null) return null;
    x.push(nivel, nivel - antes);
  }
  if (m.represa) {
    const s = series.yacyreta ?? [];
    const ahora = enDia(s, hoy);
    const antes = enDia(s, menosDias(hoy, 3));
    if (ahora === null || antes === null) return null;
    x.push((ahora - antes) / 10_000);
  }
  if (m.lluvia) {
    const pasada = lluvia?.pasada(hoy) ?? null;
    const futura = lluvia?.futura(hoy, m.horizonte) ?? null;
    if (pasada === null || futura === null) return null;
    x.push(pasada / 100, futura / 100);
  }
  return x;
}

/**
 * La corrección por crecida («sube») vale sólo la primera semana de la
 * subida de Corrientes: ahí la regresión se queda corta porque la onda
 * todavía no llegó a las estaciones de abajo. Después de `SUBE_SEMANA` días
 * seguidos subiendo, la regresión sola ya erra poco (mediana −2 cm a 7 días
 * en 2005-2021, −4 en 2022-2026) y la corrección la pasaba de largo: en la
 * crecida de octubre de 2026 el escenario a una semana se pasó por 20 cm,
 * cuando sin corregir erraba 5. Sin corregir esos días, el error a 7 días
 * baja de 0,178 a 0,177 m en 2022-2026 y de 0,133 a 0,130 en 2005-2021, y
 * en las subidas de más de una semana de 0,175 a 0,158 y de 0,167 a 0,120;
 * a 3 y 14 días queda igual. Con ECMWF desde 2024 sube 1 mm a 7 días
 * (`scripts/prueba-sesgo-sube.ts`). Las bandas no cambian: salen de la
 * regresión cruda; se mueve sólo el número central.
 */
export const SUBE_SEMANA = 7;

/** Días seguidos, contando hoy, que Corrientes viene en «sube» (hasta `SUBE_SEMANA` + 1). */
export function diasSubiendo(corrientes: Observacion[], hoy: string): number {
  let n = 0;
  while (n <= SUBE_SEMANA && regimenCorrientes(corrientes, menosDias(hoy, n)) === 'sube') n++;
  return n;
}

const corregir = (corrientes: Observacion[], hoy: string, r: Regimen) =>
  r !== 'sube' || diasSubiendo(corrientes, hoy) <= SUBE_SEMANA;

/**
 * Aplica un modelo: la regresión corrida por la mediana de su error en el
 * régimen de Corrientes, con la banda medida alrededor. La banda queda donde
 * estaba —sale de los mismos errores—; lo que se mueve es el número central
 * adentro de ella. Sin régimen no se corrige: no hay con qué saber para qué
 * lado.
 */
export function predecir(
  series: Record<string, Observacion[]>,
  hoy: string,
  m: ModeloRio,
  lluvia?: LluviaTramo | null,
): Punto | null {
  const base = regresion(series, hoy, m, lluvia);
  if (base === null) return null;
  const regimen = regimenCorrientes(series.corrientes ?? [], hoy);
  // Con automático, la variante que lo usa, con sus bandas y sesgos.
  const x = m.auto ? predictores(series, hoy, m, lluvia) : null;
  const delta = m.auto ? cambioAutomatico(series, hoy) : null;
  const auto = m.auto && x && delta !== null ? m.auto : null;
  const crudo = auto ? [...x!, delta!].reduce((a, v, i) => a + v * auto.coef[i], 0) : base;
  const t = auto ? { bandas: { [m.horizonte]: auto.bandas }, sesgos: { [m.horizonte]: auto.sesgos } } : tablas(m);
  const b = banda(t.bandas[m.horizonte], regimen);
  const metros = crudo - (regimen && corregir(series.corrientes ?? [], hoy, regimen) ? t.sesgos[m.horizonte][regimen] : 0);
  const r = (v: number) => Number(v.toFixed(2));
  const nombre = m.represa ? 'represa' : m.lluvia ? (m.medio ? 'lluvia-medio' : 'lluvia') : m.medio ? 'medio' : 'base';
  return {
    dia: menosDias(hoy, 1 - m.horizonte),
    metros: r(metros),
    min: r(crudo + b[0]),
    max: r(crudo + b[1]),
    modelo: auto ? (`${nombre}-auto` as 'base-auto' | 'medio-auto') : nombre,
  };
}

/**
 * Todos los horizontes, saltando los que no se pueden calcular. Con lluvia del
 * tramo, a 14 y 17 días usa también Yacyretá; a 7 y 10, sólo la lluvia. Si
 * falta Yacyretá, el de lluvia; si falta la lluvia (Open-Meteo no respondió),
 * el de siempre con su banda de siempre, y 17 días no sale.
 */
export function pronosticar(series: Record<string, Observacion[]>, hoy: string, lluvia?: LluviaTramo | null): Punto[] {
  const horizontes = [...new Set([...MODELOS, ...MODELOS_REPRESA].map((m) => m.horizonte))].sort((a, b) => a - b);
  const puntos = horizontes.map((h) => {
    // Del más completo al más simple: si a uno le falta un dato, el siguiente.
    // Los del medio piden tres estaciones más; sin alguna, sale el de las cinco.
    const candidatos = lluvia
      ? [MODELOS_REPRESA, MODELOS_MEDIO, MODELOS_LLUVIA, MODELOS].map((ms) => ms.find((x) => x.horizonte === h))
      : [MODELOS_MEDIO.find((x) => x.horizonte === h && !x.lluvia), MODELOS.find((x) => x.horizonte === h)];
    for (const m of candidatos) {
      const p = m && predecir(series, hoy, m, lluvia);
      if (p) return p;
    }
    return null;
  });
  topeCrecida(series, hoy, horizontes, puntos);
  return puntos.filter((p): p is Punto => p !== null);
}

/**
 * Con Corrientes subiendo rápido, a 14 y 17 días el modelo lee su altura de
 * hoy como si fuera a llegar entera, y en las crecidas la onda se achata en
 * los bañados de abajo: en 2005-2026, los días con un salto pronosticado de
 * más de 50 cm entre 10 y 14 días, el salto real fue de 13-17 cm y el de 14
 * días se pasó por 50-70 cm. El de 10 días mira Reconquista, que ya trae la
 * onda achatada. Así que en esos días 14 y 17 no quedan más de
 * `TOPE_CRECIDA.metros` por encima del de 10, y la banda se corre con el
 * número. En 2022-2026, que el ajuste no vio, el error de esos días baja de
 * 0,220 a 0,188 m a 14 días y de 0,245 a 0,198 a 17, y el de todos los días
 * queda igual (`scripts/prueba-tope-crecida.ts`).
 *
 * Desde el 6/11/2026 el tope va desde subidas de 1 m (antes 1,5) y deja 25 cm
 * (antes 35). Antes, un tope más bajo empeoraba porque a veces el de 10 días
 * se quedaba corto (octubre de 2025); desde que la corrección por crecida
 * vale sólo la primera semana (`SUBE_SEMANA`), el de 10 días ya no se queda
 * corto en las subidas largas. En la crecida de octubre de 2026 el de 14
 * días se pasaba por 60-75 cm antes de prenderse el tope (Corrientes +1,3 m)
 * y por 33 con él, cuando entre los días 10 y 14 el río subió 7-12 cm. Con
 * los valores nuevos el error de todos los días mejora o queda igual en cada
 * período (2005-2021: 0,194 → 0,192 a 14 días, 0,224 → 0,222 a 17;
 * 2022-2026: 0,221 → 0,220 y 0,271 igual; con ECMWF: 0,221 → 0,220 y 0,271 →
 * 0,270), y en esa crecida baja de 0,245 a 0,171 a 14 días y de 0,212 a
 * 0,125 a 17. Con 20 cm esa crecida mejoraba más, pero 17 días empeoraba
 * 1-3 mm en 2022-2026.
 *
 * El tope sigue prendido `TOPE_CRECIDA.memoria` días después de la última
 * vez que Corrientes subió más que eso. Sin memoria se apagaba de golpe
 * cuando el comienzo de la subida salía de la ventana de 10 días, con la onda
 * todavía en camino, y el de 14 días quedaba 75 cm arriba del de 10
 * (26/10/2026: 4,87 m contra 4,12; con el tope, 4,47). En los días en que
 * la memoria cambia el número, el error baja de 0,32 a 0,14 m a 14 días y de
 * 0,29 a 0,17 a 17 en 2022-2026, de 0,38 a 0,33 y de 0,25 a 0,19 en
 * 2005-2021, y con ECMWF no cambia ningún día. Mirar
 * la subida en 14 días, o topear siempre según el salto, empeoraba en algún
 * período.
 */
export const TOPE_CRECIDA = { subida: 1.0, metros: 0.25, memoria: 7 };

/**
 * Si a 14 y 17 días va el tope: Corrientes subió más de `TOPE_CRECIDA.subida`
 * en 10 días hoy o en alguno de los `TOPE_CRECIDA.memoria` días anteriores.
 */
export function topeCrecidaActivo(corrientes: Observacion[], hoy: string): boolean {
  for (let k = 0; k <= TOPE_CRECIDA.memoria; k++) {
    const c = cambioCorrientes(corrientes, menosDias(hoy, k));
    if (c !== null && c > TOPE_CRECIDA.subida) return true;
  }
  return false;
}

function topeCrecida(series: Record<string, Observacion[]>, hoy: string, horizontes: number[], puntos: (Punto | null)[]) {
  const p10 = puntos[horizontes.indexOf(10)];
  if (!p10 || !topeCrecidaActivo(series.corrientes ?? [], hoy)) return;
  const techo = p10.metros + TOPE_CRECIDA.metros;
  horizontes.forEach((h, i) => {
    const p = puntos[i];
    if (h < 14 || !p || p.metros <= techo) return;
    const r = (v: number) => Number(v.toFixed(2));
    const baja = p.metros - techo;
    puntos[i] = { ...p, metros: r(techo), min: r(p.min - baja), max: r(p.max - baja) };
  });
}

/** El cuadro de Prefectura del día: su fecha y la altura de cada estación, por slug. */
export interface CuadroDelDia {
  fecha: string | null;
  alturas: Record<string, number | null | undefined>;
}

/**
 * Las series con la lectura del cuadro de Prefectura del día agregada al
 * final. La serie histórica del INA copia ese cuadro con un día de atraso, y
 * el modelo corría con lecturas un día más viejas de las que la página ya
 * mostraba: el 10/11/2026, en plena crecida, usaba Rosario en 4,22 m y Paraná
 * en 5,05 cuando el cuadro decía 4,30 y 5,20, y venía quedándose 11 cm corto
 * a uno y dos días. Con todas las estaciones un día más nuevas, el error para
 * una misma fecha baja 15 % a 3 días, 13 % a 5, 11 % a 7, 16 % a 10 y 9 % a
 * 14 (2022-2026, modelos sin lluvia ajustados en 2005-2021). Los
 * coeficientes no cambian: es el mismo modelo corrido un día después.
 *
 * Sólo si el cuadro es del día siguiente al último de Rosario y trae a
 * Rosario y a las cinco de `ESTACIONES_Y`; si no, las series como vienen: un
 * hueco de un día o una estación sin lectura dejarían horizontes sin
 * calcular. Las del medio se agregan si están; sin alguna, ese día sale el
 * modelo de las cinco.
 *
 * Yacyretá no está en el cuadro: se repite su último dato. El modelo usa su
 * cambio en 3 días, que así queda medido en 2, y eso cuesta menos de lo que
 * da el día ganado: con ECMWF desde 2024 la regresión pasa de 0,215 a 0,220 m
 * a 14 días y de 0,265 a 0,272 a 17 (2-3 %).
 */
export function conCuadro(series: Record<string, Observacion[]>, cuadro: CuadroDelDia): Record<string, Observacion[]> {
  const ultimo = series.rosario?.at(-1)?.dia;
  if (!ultimo || cuadro.fecha !== menosDias(ultimo, -1)) return series;
  const fecha = cuadro.fecha;
  const altura = (k: string) => {
    const v = cuadro.alturas[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  if (['rosario', ...ESTACIONES_Y].some((k) => altura(k) === null || series[k]?.at(-1)?.dia !== ultimo)) return series;
  const out: Record<string, Observacion[]> = {};
  for (const [k, s] of Object.entries(series)) {
    const fin = s.at(-1);
    const metros = k === 'yacyreta' ? (fin?.metros ?? null) : altura(k);
    out[k] = fin?.dia === ultimo && metros !== null ? [...s, { dia: fecha, metros }] : s;
  }
  return out;
}

/**
 * El escenario de hoy con el cuadro del día (`conCuadro`), y el día desde el
 * que corrió. Si con el cuadro salen menos horizontes que sin él, el de las
 * series solas: un día más nuevo no vale perder un plazo.
 */
export function pronosticarAlDia(
  series: Record<string, Observacion[]>,
  cuadro: CuadroDelDia | null,
  lluvia?: LluviaTramo | null,
): { hoy: string; puntos: Punto[] } {
  const ultimo = series.rosario?.at(-1)?.dia;
  if (!ultimo) return { hoy: '', puntos: [] };
  const base = { hoy: ultimo, puntos: pronosticar(series, ultimo, lluvia) };
  const nuevas = cuadro ? conCuadro(series, cuadro) : series;
  if (nuevas === series) return base;
  const hoy = nuevas.rosario.at(-1)!.dia;
  const puntos = pronosticar(nuevas, hoy, lluvia);
  return puntos.length >= base.puntos.length ? { hoy, puntos } : base;
}
