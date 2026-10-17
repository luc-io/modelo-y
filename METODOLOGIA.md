# Metodología de Y

Modelo estadístico de la altura del río Paraná en Rosario a 3, 5, 7, 10 y 14 días. Versión del 17 de octubre de 2026.

Este documento describe qué hace el modelo, cómo se ajustó y cómo se midió, incluidas las pruebas que no mejoraron nada. Al final hay preguntas abiertas donde una mirada especializada sería lo más útil.

## 1. Datos

**Alturas.** Series diarias del Sistema de Alerta del INA (`https://alerta.ina.gob.ar/a5/obs/puntual/series/{id}`), que copian el cuadro de Prefectura Naval. Período usado: noviembre de 2004 a octubre de 2026.

| Estación | Serie INA | Retraso a Rosario |
|---|---|---|
| Corrientes | 19 | 14 días |
| Goya | 23 | 11 días |
| Reconquista | 24 | 10 días |
| La Paz | 26 | 6 días |
| Paraná | 29 | 3 días |
| Santa Fe | 30 | 2 días |
| Diamante | 31 | 2 días |
| Rosario | 34 | — |

Los retrasos se eligieron maximizando la correlación entre cada estación desplazada y Rosario sobre diez años; las correlaciones dan entre 0,93 y 0,99.

**Lluvia.** Promedio de seis puntos sobre los afluentes del tramo argentino entre Corrientes y Rosario: (−61,0; −31,0), (−61,5; −29,5), (−60,0; −28,5), (−58,8; −29,5), (−59,3; −31,0), (−58,0; −28,5), en lon/lat. Cubren el Salado santafesino, el norte de Santa Fe y el sureste del Chaco por la derecha, y Corrientes y el norte de Entre Ríos (ríos Corriente, Feliciano y Guayquiraró) por la izquierda.

- Para ajustar: ERA5 diario (precipitación acumulada, día local de Buenos Aires), vía el archivo de Open-Meteo.
- En vivo: pronóstico ECMWF IFS 0,25° vía Open-Meteo, con los días pasados que esa misma API devuelve.
- Para medir con lo que se sabía cada día: la API de corridas anteriores de Open-Meteo, que guarda desde febrero de 2024 lo que cada modelo pronosticó con 1 a 7 días de anticipación.
- Lluvia típica: media diaria de ERA5 2005-2021 por día del año, con ventana de ±15 días.

## 2. El modelo

Para cada plazo *h* hay una regresión lineal distinta, ajustada por mínimos cuadrados:

```
H_Rosario(t + h) = a + b · H_Rosario(t)
                 + Σ_k [ c_k · H_k(t − (r_k − h)) + d_k · (H_k(t − (r_k − h)) − H_k(t − (r_k − h) − 3)) ]
                 + e · P_pasada(t) + f · P_futura(t, h)        (sólo h ≥ 7)
```

- *t* es el último día con altura de Rosario.
- *k* recorre las estaciones con retraso *r_k* ≥ *h*: las que todavía «alcanzan» a informar ese plazo. A 3 días son cinco (Corrientes a Paraná); a 14, sólo Corrientes.
- Para cada estación entran el nivel y su cambio en 3 días, en el día que corresponde a su retraso.
- *P_pasada* es la lluvia del tramo en los 7 días hasta *t*.
- *P_futura* es la lluvia pronosticada para los días *t+1* a *t+7*, más la típica de la época para *t+8* a *t+h*. Ambas van en decenas de mm.

| Plazo | Estaciones |
|---|---|
| 3 días | Corrientes, Goya, Reconquista, La Paz, Paraná |
| 5 días | Corrientes, Goya, Reconquista, La Paz |
| 7 días | Corrientes, Goya, Reconquista (+ lluvia) |
| 10 días | Corrientes, Goya, Reconquista (+ lluvia) |
| 14 días | Corrientes (+ lluvia) |

Los coeficientes están en `src/lib/pronostico-rio.ts` (`MODELOS` y `MODELOS_LLUVIA`). Los de lluvia salen positivos en los tres plazos, como corresponde físicamente.

**Corrección por régimen.** Se clasifica cada día según cuánto cambió Corrientes en los 10 días previos: *sube* (más de +40 cm), *baja* (menos de −15 cm) o *resto*. La regresión lineal se queda corta con crecidas rápidas y se pasa con bajantes. Por eso al número se le resta la mediana del error medida en cada régimen.

**Banda.** Los percentiles 10 y 90 del error (pronosticado − real), por plazo y régimen, alrededor de la regresión sin corregir. Lo real cae adentro 8 de cada 10 veces en el período de prueba.

**Empalme con el INA.** Donde llega el pronóstico oficial del INA (hasta 3-4 días), manda el INA. Y se muestra desde 2 días después de su último día, para que la costura entre los dos modelos no parezca un salto.

## 3. Validación

- **Ajuste:** 2005-2021.
- **Prueba del modelo sin lluvia:** 2022-2026, años que el ajuste no vio y que incluyen la bajante histórica de 2021-2023.
- **Prueba del modelo con lluvia:** desde el 15 de febrero de 2024, usando lo que ECMWF de verdad pronosticaba cada día, no la lluvia que después cayó. Es el período que cubre el archivo de pronósticos.

### Modelo sin lluvia (2022-2026)

| Plazo | Error absoluto medio |
|---|---|
| 3 días | 0,104 m |
| 5 días | 0,145 m |
| 7 días | 0,198 m |
| 10 días | 0,214 m |
| 14 días | 0,280 m |

Le gana a la persistencia (suponer que el río se queda donde está) por entre un 21 y un 32 % según el plazo.

Banda p10/p90 del error (m), por régimen:

| Plazo | sube | baja | resto |
|---|---|---|---|
| 3 | −0,14 / 0,14 | −0,11 / 0,18 | −0,13 / 0,18 |
| 5 | −0,29 / 0,13 | −0,14 / 0,28 | −0,24 / 0,23 |
| 7 | −0,51 / 0,09 | −0,18 / 0,37 | −0,31 / 0,25 |
| 10 | −0,49 / 0,14 | −0,22 / 0,41 | −0,39 / 0,26 |
| 14 | −0,57 / 0,26 | −0,34 / 0,61 | −0,46 / 0,40 |

Medidas el 12 de octubre de 2026. `npm run margen` las recalcula con todos los días hasta hoy, así que puede moverlas ±1 cm.

### Modelo con lluvia (desde febrero de 2024, mismos días)

Número corregido por el sesgo y banda alrededor, como se publica:

| Plazo | n | Error sin lluvia | Error con lluvia | Cambio | Banda sin | Banda con | Cobertura sin | Cobertura con |
|---|---|---|---|---|---|---|---|---|
| 7 | 917 | 0,181 m | 0,168 m | −7 % | 57 cm | 53 cm | 79 % | 80 % |
| 10 | 911 | 0,201 m | 0,178 m | −11 % | 64 cm | 58 cm | 80 % | 80 % |
| 14 | 903 | 0,261 m | 0,240 m | −8 % | 89 cm | 76 cm | 82 % | 80 % |

**Cuidado:** las bandas del modelo con lluvia se midieron sobre esos mismos días, por lo que su cobertura del 80 % es por construcción. Las del modelo sin lluvia vienen de 2022-2026.

Banda p10/p90 del error con lluvia (m):

| Plazo | sube | baja | resto |
|---|---|---|---|
| 7 | −0,46 / 0,11 | −0,18 / 0,35 | −0,27 / 0,24 |
| 10 | −0,45 / 0,14 | −0,22 / 0,37 | −0,32 / 0,24 |
| 14 | −0,55 / 0,22 | −0,27 / 0,46 | −0,37 / 0,43 |

## 4. Lo que se probó para llegar a la lluvia

Todas las pruebas con el mismo protocolo: ajuste 2005-2021 y medición fuera de muestra. El código está en `scripts/prueba-lluvia.ts`.

### 4.1 Con lluvia perfecta (ERA5), 2022-2026

Tres subcuencas: el tramo argentino (los seis puntos de arriba), el Paraguay inferior y el Alto Paraná con el Iguazú. «Observado» suma la lluvia de los 7 días previos y la humedad del suelo de ERA5-Land (7-28 cm). «Oráculo» agrega además la lluvia que cayó entre mañana y el día pronosticado, y esa lluvia multiplicada por el suelo.

| Plazo | Sin lluvia | + observado | + oráculo |
|---|---|---|---|
| 3 | 0,103 | 0,104 | 0,102 |
| 5 | 0,143 | 0,144 | 0,139 |
| 7 | 0,197 | 0,192 | 0,182 |
| 10 | 0,212 | 0,200 | 0,186 |
| 14 | 0,279 | 0,267 | 0,248 |

Por subcuenca, sola (error a 14 días):

| Subcuenca | + observado | + oráculo |
|---|---|---|
| Tramo argentino | 0,264 | 0,244 |
| Paraguay inferior | 0,273 | 0,266 |
| Alto Paraná e Iguazú | 0,269 | 0,261 |

Casi toda la ganancia de la lluvia futura sale del tramo argentino. La del Alto Paraná y del Paraguay llega a Rosario después de los 14 días. Lo que aportan, lo aportan por la lluvia ya caída y el suelo, sobre todo con Corrientes en crecida.

### 4.2 Con pronósticos reales, desde febrero de 2024

Lluvia futura sólo sobre el tramo argentino, con los mismos coeficientes ajustados con ERA5. Del día 8 en adelante, la típica de la época.

| Plazo | Sin lluvia | ERA5 (techo) | ECMWF | GFS | Sólo la típica |
|---|---|---|---|---|---|
| 7 | 0,200 | 0,183 | 0,183 | 0,188 | 0,196 |
| 10 | 0,212 | 0,183 | 0,183 | 0,192 | 0,199 |
| 14 | 0,266 | 0,244 | 0,250 | 0,247 | 0,260 |

Correlación entre la lluvia diaria pronosticada para el tramo y la de ERA5, por anticipación:

| Anticipación | 1 | 2 | 3 | 4 | 5 | 6 | 7 días |
|---|---|---|---|---|---|---|---|
| ECMWF | 0,92 | 0,86 | 0,82 | 0,80 | 0,68 | 0,65 | 0,55 |
| GFS | 0,78 | 0,77 | 0,74 | 0,72 | 0,62 | 0,45 | 0,42 |

Que la correlación caiga con la anticipación indica que el archivo guarda pronósticos genuinos, sin fuga de lo observado. Que ECMWF iguale al techo a 10 días es consistente con la física: la lluvia de los últimos días del plazo todavía no llegó a Rosario, así que deciden los primeros 4-5 días de pronóstico, que son los buenos.

### 4.3 Qué hacer con lo observado en vivo

ERA5 se publica con unos 5 días de atraso. Opciones medidas con ECMWF desde febrero de 2024 (error a 7 / 10 / 14 días):

| Opción | 7 | 10 | 14 |
|---|---|---|---|
| Sólo lluvia futura | 0,188 | 0,195 | 0,257 |
| + suelo rezagado 7 días | 0,186 | 0,194 | 0,254 |
| Lluvia y suelo observados, rezagados 7 días | 0,182 | 0,192 | 0,259 |
| Lluvia pasada según ECMWF + suelo rezagado | 0,184 | 0,188 | 0,246 |
| **Lluvia pasada según ECMWF, sin suelo (la elegida)** | **0,185** | **0,190** | **0,249** |
| Observado sin rezago (imposible en vivo) | 0,182 | 0,182 | 0,248 |

La lluvia de la última semana se toma de lo que ECMWF pronosticó con un día de anticipación para cada día, algo que está disponible en vivo. La humedad del suelo mejoraba 1 a 3 mm y pedía una segunda fuente, así que quedó afuera.

## 5. Limitaciones conocidas

- **Horizonte de 14 días:** más allá, el agua no pasó por ninguna estación observada.
- **Linealidad:** las crecidas y bajantes rápidas se corrigen con un sesgo por régimen, que es un parche. Un evento sin precedentes en 2005-2021 puede quedar fuera de la banda.
- **Muestra corta para la lluvia:** la prueba con pronósticos reales cubre 2,6 años de días consecutivos, muy correlacionados entre sí.
- **Represas:** lo que se suelta en Brasil se ve recién cuando pasa por Corrientes.
- **Puntos fijos para la lluvia:** no son cuencas delimitadas ni ponderadas por área.
- **Altura, no caudal:** el modelo trabaja sobre alturas de escala, no sobre caudales.

## 6. Preguntas abiertas

Donde más nos serviría una opinión especializada:

1. **Retrasos variables.** La velocidad de la onda depende del nivel y del caudal. ¿Conviene que el retraso Corrientes → Rosario varíe con el estado del río?
2. **Alturas o caudales.** ¿Mejoraría trabajar con caudales (curvas H-Q) en lugar de alturas, o con un modelo no lineal para las crecidas rápidas?
3. **Lluvia por cuenca.** ¿Qué delimitación y qué ponderación usarían para los afluentes del tramo (Salado, Feliciano, Guayquiraró, Corriente)? ¿Cómo entraría la humedad del suelo como lluvia efectiva? Tal como la probamos, no ayudó.
4. **Validación.** ¿Qué métricas o qué eventos de referencia usarían para comparar con otros modelos (por ejemplo, NSE o eventos de crecida concretos)?
5. **El pronóstico del INA como predictor.** ¿Tiene sentido usar el pronóstico oficial a 3-4 días como entrada de los plazos más largos?
6. **Datos que no estamos usando.** ¿Hay series abiertas de caudal, de afluentes o de embalses que deberíamos sumar?

Las respuestas, en los [issues](../../issues) del repositorio o por mail.

## 7. Atribuciones

Alturas: Instituto Nacional del Agua, Sistema de Alerta Hidrológico de la Cuenca del Plata (CC BY 4.0), sobre lecturas de Prefectura Naval Argentina. Reanálisis: Hersbach et al. (2020), ERA5; Muñoz-Sabater et al. (2021), ERA5-Land, Copernicus Climate Change Service. Pronósticos: ECMWF IFS open data y NOAA GFS, vía Open-Meteo (CC BY 4.0).
