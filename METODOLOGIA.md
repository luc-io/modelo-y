# Metodología de Y

Modelo estadístico de la altura del río Paraná en Rosario a 3, 5, 7, 10, 14 y 17 días. Versión del 6 de noviembre de 2026: las cinco estaciones en todos los plazos, Bella Vista, Esquina y Santa Elena de 3 a 10 días, y desde 7 días la mezcla mitad alturas, mitad variaciones.

Este documento describe qué hace el modelo, cómo se ajustó y cómo se midió, incluidas las pruebas que no mejoraron nada. Al final hay preguntas abiertas donde una mirada especializada sería lo más útil.

## 1. Datos

**Alturas.** Series diarias del Sistema de Alerta del INA (`https://alerta.ina.gob.ar/a5/obs/puntual/series/{id}`), que copian el cuadro de Prefectura Naval. Período usado: noviembre de 2004 a octubre de 2026.

| Estación | Serie INA | Retraso a Rosario |
|---|---|---|
| Corrientes | 19 | 14 días |
| Bella Vista | 22 | 12 días (sus cambios, 6) |
| Goya | 23 | 11 días |
| Reconquista | 24 | 10 días |
| Esquina | 25 | 8 días (sus cambios, 4) |
| La Paz | 26 | 6 días |
| Santa Elena | 27 | 5 días (sus cambios, 3) |
| Paraná | 29 | 3 días |
| Santa Fe | 30 | 2 días |
| Diamante | 31 | 2 días |
| Rosario | 34 | — |

Los retrasos se eligieron maximizando la correlación entre cada estación desplazada y Rosario sobre diez años; las correlaciones dan entre 0,93 y 0,99. Los de Bella Vista, Esquina y Santa Elena se midieron el 6/11/2026 igual, con 2005-2021, y se llevaron a la misma escala: con ese método Corrientes da 16 y Paraná 4, uno o dos más que los de siempre. Para esas tres, el modelo no usa el retraso del agua sino el de sus cambios (`RETARDOS_CAMBIO`): cuántos días tarda en notarse en Rosario un cambio de la estación, el que maximiza la correlación entre su cambio en 3 días y el de Rosario después. Hernandarias no entra: tiene huecos de días seguidos.

**Represas.** Caudal efluente diario de Yacyretá, serie 937 del INA (desde 1994, 99 % de los días desde 2005), en m³/s. Para las pruebas, también la vazão defluente diaria de Itaipú del ONS (`dados_hidrologicos_di`, reservatorio `PNITAI`, CC BY 4.0, desde 2000). Los dos se publican al día siguiente.

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
                 + g · (Q_Yacy(t) − Q_Yacy(t − 3))             (sólo h ≥ 14)
                 + e · P_pasada(t) + f · P_futura(t, h)        (sólo h ≥ 7)
```

- *t* es el último día con altura de Rosario.
- *k* recorre las cinco estaciones, Corrientes, Goya, Reconquista, La Paz y Paraná (`ESTACIONES_Y`), en todos los plazos. Las que todavía no mandaron su agua (*r_k* ≥ *h*) entran del día en que la mandan; las que ya la mandaron, con su dato de hoy (el desplazamiento se acota en 0), que dice si la onda ya pasó por ahí. Hasta el 6/11/2026 cada plazo miraba sólo las primeras (a 14 días, sólo Corrientes), ver §4.7. De 3 a 10 días se suman Bella Vista, Esquina y Santa Elena, con el retraso de sus cambios (`MODELOS_MEDIO`, §4.8).
- *Q_Yacy* es el caudal que suelta Yacyretá, en decenas de miles de m³/s. Entra sólo su cambio en 3 días, no su nivel (ver 4.4).
- Para cada estación entran el nivel y su cambio en 3 días, en el día que corresponde a su retraso.
- *P_pasada* es la lluvia del tramo en los 7 días hasta *t*.
- *P_futura* es la lluvia pronosticada para los días *t+1* a *t+7*, más la típica de la época para *t+8* a *t+h*. Ambas van en decenas de mm.

| Plazo | Estaciones | Además |
|---|---|---|
| 3 días | las cinco + las tres del medio | |
| 5 días | las cinco + las tres del medio | |
| 7 días | las cinco + las tres del medio | lluvia; mezcla con variaciones |
| 10 días | las cinco + las tres del medio | lluvia; mezcla con variaciones |
| 14 días | las cinco | lluvia + Yacyretá; mezcla con variaciones |
| 17 días | las cinco | lluvia + Yacyretá; mezcla con variaciones |

Los coeficientes están en `src/lib/pronostico-rio.ts` (`MODELOS`, `MODELOS_MEDIO`, `MODELOS_LLUVIA` y `MODELOS_REPRESA`).

**Mezcla con variaciones, desde 7 días.** Cada modelo de 7 días o más tiene un gemelo «sólo variaciones» (`cambios`) que pronostica cuánto va a cambiar Rosario sin mirar ninguna altura:

```
H_Rosario(t + h) − H_Rosario(t) = a' + Σ_k [ c'_k · (H_k(s_k) − H_k(s_k − 3)) + d'_k · (H_k(s_k) − H_k(s_k − 10)) ]
                                + b' · (H_Rosario(t) − H_Rosario(t − 7))
                                + (Yacyretá y lluvia como arriba, si el modelo los usa)
```

con *s_k* el mismo día que mira la regresión con alturas. El número publicado es el promedio de los dos (`PESO_ALTURA` = 0,5). Las alturas dicen hacia dónde tiende Rosario (con Corrientes alta y Rosario bajo, falta agua por llegar); las variaciones, la forma de la onda. Solas, las alturas sobreajustan. Si al gemelo le falta historia (el cambio en 10 días), sale el de alturas solo. Ver §4.9.

Si en vivo falta un dato se usa el modelo más completo que se pueda calcular: con lluvia, Yacyretá, después el de las estaciones del medio, después el de lluvia y por último el de sólo estaciones; sin lluvia, el de las estaciones del medio y después el de las cinco. Una falla del INA en Bella Vista, Esquina o Santa Elena no tira abajo el pronóstico. A 17 días, sin Yacyretá no sale.

**Corrección no lineal, de 3 a 10 días.** A la regresión de `MODELOS_MEDIO` se le suma una segunda cuenta que aprende el error que la primera deja:

```
H_Rosario(t + h) = regresión(t, h) + Σ_i árbol_i(x(t))        (h = 3, 5, 7, 10)
```

Cada árbol hace dos preguntas encadenadas sobre *x(t)* («¿Rosario está abajo de 2,05 m?», «¿Corrientes subió más de 3 cm ayer?») y devuelve unos milímetros; son 150 por plazo, ajustados por boosting de gradiente con pérdida cuadrática. *x(t)* son 24 números: la altura de Rosario y de las cinco estaciones como están hoy, y cuánto cambió cada una en 1, 3 y 10 días. No mira la lluvia. Los árboles están en `src/lib/correccion-rio-datos.ts` y la cuenta en `src/lib/correccion-rio.ts`. Con la corrección van bandas y sesgos propios (`BANDAS_CORREGIDO`, `SESGOS_CORREGIDO`). Si falta un dato, o ese día no sale el modelo con las estaciones del medio, el punto sale sin corregir. A 14 y 17 días no hay corrección. Ver §4.12.

**Corrección por régimen.** Se clasifica cada día según cuánto cambió Corrientes en los 10 días previos: *sube* (más de +40 cm), *baja* (menos de −15 cm) o *resto*. La regresión lineal se queda corta con crecidas rápidas y se pasa con bajantes. Por eso al número se le resta la mediana del error medida en cada régimen. La corrección «sube» vale sólo la primera semana de la subida: si Corrientes ya lleva más de 7 días seguidos en *sube* (`SUBE_SEMANA`), no se corrige, porque para entonces la onda ya llegó a las estaciones de abajo y la regresión sola erra poco. La banda no cambia: sale de la regresión sin corregir. Ver §4.6.

**Tope en crecidas rápidas.** Si Corrientes subió más de 1 m en 10 días, a 14 y 17 días el número no queda más de 25 cm por encima del de 10 días, y la banda se corre con él (`TOPE_CRECIDA`). A 14 y 17 días el modelo lee la altura de Corrientes de hoy como si fuera a llegar entera, pero en una crecida rápida la onda se achata en los bañados antes de Rosario. El de 10 días mira Reconquista, que ya la trae achatada. En 2005-2026, los días en que el modelo marcaba un salto de más de 50 cm entre 10 y 14 días, el salto real fue de 13 a 17 cm y el de 14 días se pasaba por 50 a 70 cm. El tope sigue 7 días después de la última vez que Corrientes subió más de 1 m en 10 días (`TOPE_CRECIDA.memoria`): sin eso se apagaba de golpe cuando el comienzo de la subida salía de la ventana de 10 días, con la onda todavía en camino. Hasta el 6/11/2026 iba desde subidas de 1,5 m y dejaba 35 cm. Ver §4.5.

**Banda.** Los percentiles 10 y 90 del error (pronosticado − real), por plazo y régimen, alrededor de la regresión sin corregir. Lo real cae adentro 8 de cada 10 veces en el período de prueba.

**Empalme con el INA.** Donde llega el pronóstico oficial del INA (hasta 3-4 días), manda el INA. Y se muestra desde 2 días después de su último día, para que la costura entre los dos modelos no parezca un salto.

## 3. Validación

- **Ajuste:** 2005-2021.
- **Prueba del modelo sin lluvia:** 2022-2026, años que el ajuste no vio y que incluyen la bajante histórica de 2021-2023.
- **Prueba del modelo con lluvia:** desde el 15 de febrero de 2024, usando lo que ECMWF de verdad pronosticaba cada día, no la lluvia que después cayó. Es el período que cubre el archivo de pronósticos.

Todos los números de esta sección son del pronóstico como se publica: corregido por el sesgo, con la banda alrededor y, desde 7 días, con la mezcla. Medidos el 6/11/2026 con `npm run ajuste-modelo-y`, que reajusta todo y lo compara con las constantes del código sobre los mismos días.

### Modelo de las cinco estaciones, sin lluvia (2022-2026)

| Plazo | n | Error absoluto medio | Banda p10-p90 | Cubre |
|---|---|---|---|---|
| 3 días | 1730 | 0,096 m | 29 cm | 80 % |
| 5 días | 1728 | 0,130 m | 42 cm | 80 % |
| 7 días | 1726 | 0,147 m | 47 cm | 80 % |
| 10 días | 1720 | 0,188 m | 62 cm | 80 % |
| 14 días | 1712 | 0,245 m | 80 cm | 80 % |

A 7 días, con las estaciones de antes, era 0,176 m y la banda de 57 cm (§4.7).

Banda p10/p90 del error (m), por régimen:

| Plazo | sube | baja | resto |
|---|---|---|---|
| 3 | −0,13 / 0,14 | −0,12 / 0,18 | −0,13 / 0,18 |
| 5 | −0,23 / 0,17 | −0,12 / 0,28 | −0,21 / 0,26 |
| 7 | −0,33 / 0,12 | −0,12 / 0,34 | −0,26 / 0,24 |
| 10 | −0,40 / 0,23 | −0,21 / 0,37 | −0,36 / 0,30 |
| 14 | −0,41 / 0,34 | −0,34 / 0,46 | −0,46 / 0,38 |

`npm run ajuste-modelo-y` las recalcula con todos los días hasta hoy, así que puede moverlas ±1 cm.

### Modelo con lluvia (desde febrero de 2024, con ECMWF)

| Plazo | n | Error absoluto medio | Banda p10-p90 | Cubre |
|---|---|---|---|---|
| 7 | 937 | 0,144 m | 44 cm | 80 % |
| 10 | 931 | 0,174 m | 55 cm | 80 % |
| 14 | 923 | 0,225 m | 74 cm | 80 % |

**Cuidado:** las bandas del modelo con lluvia se midieron sobre esos mismos días, por lo que su cobertura del 80 % es por construcción. Las del modelo sin lluvia vienen de 2022-2026.

Banda p10/p90 del error con lluvia (m):

| Plazo | sube | baja | resto |
|---|---|---|---|
| 7 | −0,30 / 0,10 | −0,09 / 0,36 | −0,22 / 0,24 |
| 10 | −0,33 / 0,19 | −0,19 / 0,35 | −0,32 / 0,27 |
| 14 | −0,40 / 0,34 | −0,32 / 0,43 | −0,38 / 0,36 |

### Modelo con lluvia y Yacyretá (desde febrero de 2024, mismos días)

| Plazo | n | Error absoluto medio | Banda p10-p90 | Cubre |
|---|---|---|---|---|
| 14 | 923 | 0,212 m | 71 cm | 80 % |
| 17 | 920 | 0,263 m | 84 cm | 79 % |

A 17 días, la persistencia erra 0,412 m.

Banda p10/p90 del error con lluvia y Yacyretá (m):

| Plazo | sube | baja | resto |
|---|---|---|---|
| 14 | −0,37 / 0,34 | −0,27 / 0,42 | −0,40 / 0,32 |
| 17 | −0,43 / 0,44 | −0,38 / 0,44 | −0,47 / 0,38 |

Como con la lluvia, estas bandas se midieron sobre los mismos días que la tabla anterior.

### Con las estaciones del medio

Contra el modelo de las cinco, sobre los mismos días (3 y 5 días sin lluvia, en 2022-2026; 7 y 10 con lluvia de ECMWF, desde febrero de 2024):

| Plazo | n | Las cinco | + las del medio | Cambio | Banda | Cubre |
|---|---|---|---|---|---|---|
| 3 | 1642 | 0,091 m | 0,087 m | −5 % | 29 → 27 cm | 80 % |
| 5 | 1640 | 0,125 m | 0,109 m | −13 % | 42 → 34 cm | 79 % |
| 7 | 910 | 0,141 m | 0,127 m | −10 % | 44 → 41 cm | 80 % |
| 10 | 904 | 0,173 m | 0,168 m | −3 % | 55 → 53 cm | 79 % |

Hay menos días que en las otras tablas porque las tres estaciones tienen más huecos.

Banda p10/p90 del error con las del medio (m):

| Plazo | sube | baja | resto |
|---|---|---|---|
| 3 | −0,13 / 0,13 | −0,11 / 0,16 | −0,13 / 0,15 |
| 5 | −0,21 / 0,12 | −0,12 / 0,21 | −0,18 / 0,18 |
| 7 | −0,22 / 0,13 | −0,16 / 0,27 | −0,21 / 0,23 |
| 10 | −0,27 / 0,19 | −0,21 / 0,32 | −0,32 / 0,25 |

### Con la corrección no lineal

Lo publicado con `MODELOS_MEDIO`, sin y con la corrección, sobre los mismos días (3 y 5 días en 2022-2026; 7 y 10 con lluvia de ECMWF, desde febrero de 2024):

| Plazo | n | Sin corrección | Con corrección | Cambio | Banda | Cubre |
|---|---|---|---|---|---|---|
| 3 | 1642 | 0,087 m | 0,082 m | −5 % | 27 → 25 cm | 80 → 79 % |
| 5 | 1640 | 0,109 m | 0,097 m | −11 % | 34 → 31 cm | 79 → 79 % |
| 7 | 910 | 0,127 m | 0,115 m | −9 % | 41 → 35 cm | 80 → 79 % |
| 10 | 904 | 0,168 m | 0,155 m | −8 % | 53 → 48 cm | 79 → 80 % |

Banda p10/p90 del error con la corrección (m):

| Plazo | sube | baja | resto |
|---|---|---|---|
| 3 | −0,12 / 0,14 | −0,12 / 0,12 | −0,13 / 0,13 |
| 5 | −0,15 / 0,14 | −0,15 / 0,15 | −0,18 / 0,15 |
| 7 | −0,14 / 0,16 | −0,19 / 0,21 | −0,14 / 0,20 |
| 10 | −0,16 / 0,22 | −0,27 / 0,23 | −0,26 / 0,27 |

## 4. Lo que se probó

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

### 4.4 Represas

Con el mismo protocolo, en `scripts/prueba-represas.ts` (2022-2026, sin lluvia) y `scripts/prueba-represas-lluvia.ts` (desde 2024, con ECMWF).

**Retraso.** El cambio en 10 días del caudal se correlaciona con el de Rosario con picos débiles (r 0,24-0,28) a 15-16 días. Elegido por el error en el ajuste, el mejor retraso es siempre usar el último dato disponible. No hay retraso que afinar.

**Sin lluvia, 2022-2026** (error medio, m):

| Plazo | Persistencia | Sólo estaciones | + Yacyretá | + Itaipú | + las dos |
|---|---|---|---|---|---|
| 3 | 0,143 | 0,103 | 0,103 | 0,104 | 0,104 |
| 7 | 0,251 | 0,196 | 0,196 | 0,197 | 0,196 |
| 10 | 0,316 | 0,212 | 0,211 | 0,212 | 0,211 |
| 14 | 0,400 | 0,278 | 0,265 | 0,276 | 0,265 |
| 17 | 0,458 | 0,334 | 0,306 | 0,325 | 0,305 |
| 21 | 0,527 | 0,393 | 0,366 | 0,384 | 0,366 |

A 17 y 21 días, «sólo estaciones» es Rosario y Corrientes de hoy. Itaipú no suma sobre Yacyretá: todo lo que suelta, más el Iguazú, pasa por Yacyretá días después.

**Con lluvia, desde 2024** (error medio, m, mismos días):

| Plazo | Sólo estaciones | + lluvia | + Yacyretá | + las dos |
|---|---|---|---|---|
| 7 | 0,201 | 0,185 | 0,191 | 0,177 |
| 10 | 0,213 | 0,189 | 0,207 | 0,185 |
| 14 | 0,267 | 0,250 | 0,242 | 0,223 |
| 17 | 0,320 | 0,305 | 0,291 | 0,275 |
| 21 | 0,377 | 0,363 | 0,348 | 0,334 |

Las dos ganancias se suman: la lluvia ve los afluentes del tramo y Yacyretá el cauce principal. A 7 y 10 días Yacyretá mejora desde 2024 pero no en 2022-2026, así que no entra en esos plazos. A 14 días mejora en los dos períodos.

**Nivel o cambio.** Con el nivel y el cambio de Yacyretá, el error a 14 días da 0,223. Pero el coeficiente del nivel sale negativo, porque repite lo que ya dice Corrientes, y en un caso imposible (Yacyretá soltando cada vez más con Corrientes quieta) el modelo bajaba el río. Con sólo el cambio da 0,233 (17 días: 0,280 contra 0,276) y todos los coeficientes quedan positivos. Se eligió el cambio: se pierde 1 cm a cambio de que el modelo no haga cosas raras si un dato de Corrientes llega atrasado.

### 4.5 Tope en crecidas rápidas

Con `npm run tope-crecida`, después de `npm run ajuste-lluvia`. Error absoluto medio (m) sin y con el tope, con el mismo `pronosticar` que se publica. Esta primera tabla es la del tope original, desde subidas de 1,5 m y con 35 cm; «crecida rápida»: Corrientes subió más de 1,5 m en 10 días. Los valores de hoy (1 m y 25 cm) están al final de esta sección.

| Período | Días | Todos | Crecida rápida (n) | Cubre la banda en crecida rápida |
|---|---|---|---|---|
| 2022-2026, ERA5 (prueba) | 14 | 0,223 → 0,222 | 0,220 → 0,188 (56) | 79 → 82 % |
| 2022-2026, ERA5 (prueba) | 17 | 0,275 → 0,274 | 0,245 → 0,198 (56) | 84 → 89 % |
| desde 2024-02, ECMWF | 14 | 0,216 → 0,216 | 0,108 → 0,111 (17) | 94 → 94 % |
| desde 2024-02, ECMWF | 17 | 0,270 → 0,270 | 0,165 → 0,156 (17) | 94 → 94 % |
| 2005-2021, ERA5 (ajuste) | 14 | 0,196 → 0,196 | 0,300 → 0,271 (79) | 53 → 56 % |
| 2005-2021, ERA5 (ajuste) | 17 | 0,226 → 0,225 | 0,284 → 0,236 (76) | 75 → 95 % |

Qué más se probó: un término de interacción con la subida de Corrientes (lineal, cuadrático o desde 0,5, 1 y 1,5 m) mejoraba mucho dentro del ajuste y empeoraba en 2022-2026. Un tope más bajo (15-25 cm), o aplicado desde subidas más chicas (40 cm o 1 m), también empeoraba fuera de muestra: en octubre de 2025 el que se quedó corto fue el de 10 días, y el de 14 estaba más cerca. Con 1,5 m y 35 cm el total no empeora en ningún período; lo único que empeora son 3 mm en las crecidas rápidas a 14 días con ECMWF, sobre 17 días. La muestra de prueba es chica: 56 días de diez crecidas, muy correlacionados entre sí.

**Memoria de 7 días** (26/10/2026). Ese día Corrientes había subido 2,4 m en dos semanas y se había aplanado: el cambio en 10 días bajó de 1,61 a 1,22 m, el tope se apagó y el escenario a 14 días quedó en 4,87 m, 75 cm arriba del de 10 días (4,12). Con el tope prendido da 4,47. Ahora el tope sigue prendido 7 días después de la última vez que se cumplió la condición. Error absoluto medio (m) sin tope, con el tope sin memoria y con la memoria; «cambia la memoria»: los días en que la memoria da otro número.

| Período | Días | Con tope (n) | Cambia la memoria (n) | Cubre la banda donde cambia |
|---|---|---|---|---|
| 2022-2026, ERA5 (prueba) | 14 | 0,213 · 0,200 · 0,190 (139) | 0,317 → 0,140 (8) | 38 → 100 % |
| 2022-2026, ERA5 (prueba) | 17 | 0,236 · 0,217 · 0,206 (139) | 0,291 → 0,173 (13) | 77 → 100 % |
| desde 2024-02, ECMWF | 14 | 0,133 · 0,134 · 0,134 (47) | ningún día | — |
| desde 2024-02, ECMWF | 17 | 0,190 · 0,187 · 0,187 (47) | ningún día | — |
| 2005-2021, ERA5 (ajuste) | 14 | 0,259 · 0,248 · 0,245 (205) | 0,384 → 0,330 (11) | 18 → 27 % |
| 2005-2021, ERA5 (ajuste) | 17 | 0,268 · 0,250 · 0,245 (200) | 0,252 → 0,188 (14) | 79 → 100 % |

El total de todos los días no cambia (0,222 → 0,221 a 14 días en 2022-2026). Qué más se probó: mirar la subida en 14 días en vez de 10 (desde 1,5 o 2 m), 4 días de memoria, topear siempre que Corrientes viene subiendo, o topear siempre según el salto entre 10 y 14 días, con 35 o 50 cm. Con 4 días también mejora en todos los períodos, pero corrige menos días. Las otras empeoraban en algún período, casi siempre desde 2024 con ECMWF, que es como corre en vivo. La muestra es chica: entre 8 y 14 días por casilla.

**Desde subidas de 1 m y con 25 cm** (6/11/2026). Antes, un tope más bajo o desde subidas más chicas empeoraba porque a veces el de 10 días se quedaba corto (octubre de 2025). Desde que la corrección «sube» vale sólo la primera semana (§4.6), el de 10 días ya no se queda corto en las subidas largas. En la crecida de octubre de 2026 el de 14 días se pasaba por 60-75 cm antes de prenderse el tope (Corrientes subió 1,3 m en 10 días, menos que 1,5) y por 33 cm con él, cuando entre los días 10 y 14 el río subió 7-12 cm. Error absoluto medio de todos los días (m), con 1,5 m y 35 cm → con 1 m y 25 cm, ya con la corrección «sube» de la primera semana:

| Período | 14 días | 17 días |
|---|---|---|
| 2005-2021, ERA5 (ajuste) | 0,194 → 0,192 | 0,224 → 0,222 |
| 2022-2026, ERA5 (prueba) | 0,221 → 0,220 | 0,271 → 0,271 |
| desde 2024-02, ECMWF | 0,221 → 0,220 | 0,271 → 0,270 |
| crecida de octubre de 2026 | 0,245 → 0,171 | 0,212 → 0,125 |

Mejora o empata en todos los períodos. Con 20 cm esa crecida mejoraba más, pero a 17 días empeoraba 1-3 mm en 2022-2026.

### 4.6 Corrección «sube» sólo la primera semana

Con `npm run sesgo-sube`, después de `npm run ajuste-lluvia`. En la crecida de octubre de 2026 (Corrientes +2,4 m en 10 días) el escenario a 7 días se pasó por ~20 cm: la regresión sola erraba 5 y la corrección «sube» le sumaba 16. Mirando el error de la regresión sin corregir en los días «sube», la que se queda corta es la primera semana de la subida, cuando la onda todavía no llegó a las estaciones de abajo. Después de 7 días seguidos subiendo, la mediana del error a 7 días es de −2 cm en 2005-2021 y −4 en 2022-2026, y la corrección la pasaba de largo.

Error absoluto medio a 7 días (m), corrigiendo siempre → sin corregir «sube» después de 7 días:

| Período | Todos los días | Subidas de más de una semana |
|---|---|---|
| 2005-2021 (ajuste) | 0,133 → 0,130 | 0,167 → 0,120 |
| 2022-2026 (prueba) | 0,178 → 0,177 | 0,175 → 0,158 |

A 3 y 14 días queda igual. Con lluvia de ECMWF, desde 2024, sube 1 mm a 7 días. Medido el 6/11/2026, con datos hasta esa crecida. Qué más se probó: no corregir «sube» cuando Corrientes subió más de 2 m, que mejora menos dentro del ajuste. Y correcciones ajustadas en 2005-2021: por régimen y semana de la subida, por si Reconquista o Rosario ya venían subiendo, o lineal con las subidas de Corrientes, Reconquista y Rosario. Mejoran dentro del ajuste, pero en 2022-2026 el total empeora entre 2 y 7 mm.

**21 días.** El error baja a 0,334 m con las dos, pero la banda p10-p90 queda en ~1 m. No se publica.

### 4.7 Las cinco estaciones en todos los plazos

Con `npm run ajuste-modelo-y`, después de `npm run ajuste-lluvia`. Hasta el 6/11/2026 cada plazo miraba sólo las estaciones cuya agua todavía no había llegado a Rosario: a 14 y 17 días, sólo Corrientes. En la crecida de octubre-noviembre de 2026 el pico ya había pasado Goya y Reconquista, Corrientes bajaba de 7,42 a 7,02 m, y el escenario a 14 y 17 días seguía subiendo hasta 4,75 m porque no veía cómo estaban hoy las de abajo.

Ahora los seis plazos miran las cinco (`ESTACIONES_Y`); las que ya mandaron su agua, con su dato de hoy. Se reajustaron con 2005-2021 los modelos base, con lluvia y con Yacyretá, y se volvieron a medir bandas y sesgos (el sesgo «sube», sólo en la primera semana de la subida, que es donde se aplica). Como se publica, sobre los mismos días:

- 7 días: 0,176 → 0,147 m en 2022-2026 (−16 %).
- 10 y 14 días: entre 5 y 9 % menos.
- 14 y 17 días con lluvia y Yacyretá: entre 5 y 7 % menos.
- Las bandas se angostan (a 7 días, de 57 a 47 cm) y siguen cubriendo el 80 %.

### 4.8 Bella Vista, Esquina y Santa Elena, de 3 a 10 días

Con `npm run estaciones-medias` (baja las series que falten) y `npm run ajuste-modelo-y`. Son las estaciones del medio del tramo, que tienen hoy el agua que llega a Rosario en 5 a 12 días (`ESTACIONES_MEDIO`). Con el retraso del agua sólo mejoraban a 5 días. Con el de sus cambios (`RETARDOS_CAMBIO`: Bella Vista 6, Esquina 4, Santa Elena 3), más corto y casi su dato de hoy, el error baja 5 % a 3 días, 13 % a 5, 9 % a 7 y 3 % a 10 (con datos hasta el 6/11/2026, 10 % a 7 días; ver §3). A 14 y 17 días no suman y no entran. Se ajustan sin lluvia a 3 y 5 días y con lluvia a 7 y 10 (`MODELOS_MEDIO`, con sus propias `BANDAS_MEDIO` y `SESGOS_MEDIO`). Si alguna no informó, sale el modelo de las cinco. Hernandarias no entra porque tiene huecos de días seguidos.

### 4.9 Mitad alturas, mitad variaciones, desde 7 días

Con `npm run ajuste-modelo-y`. Con las alturas solas, una Corrientes alta empuja el pronóstico de Rosario para arriba aunque la onda ya esté bajando: en noviembre de 2026, con Corrientes en 7 m y Rosario en 4,06, el modelo con alturas seguía subiendo a 14 y 17 días y el de variaciones se aplanaba. El gemelo «sólo variaciones» (§2) mira cuánto cambió cada estación en 3 y 10 días y cuánto cambió Rosario en 7, y pronostica el cambio de Rosario.

Para elegir el peso sin mirar el período de prueba, se ajustó con 2005-2015 y se midió en 2016-2021:

- La mezcla mitad y mitad erra 3-4 % menos que las alturas solas a 7 y 10 días, 4-5 % a 14 y 7 % a 17 (con Yacyretá, 0,247 → 0,230 m).
- 0,5 es el mejor peso en todos los modelos (`PESO_ALTURA`).
- En 2022-2026 la mezcla y las alturas solas empatan, y con ECMWF desde 2024 la mezcla pierde 1-2 %.

Se eligió la mezcla porque gana donde se eligió el peso sin sobreajustar y no pierde mucho donde pierde. Con la mezcla y las cinco estaciones, el 6/11/2026 el escenario quedaba en 4,16 m el 11/11, 4,35 el 14/11, 4,48 el 18/11 y 4,57 el 21/11, contra 4,30, 4,49, 4,66 y 4,75 del modelo anterior.

**Tope de crecida, revalidado.** Con el modelo nuevo y con la mezcla, el tope desde subidas de 1 m y con 25 cm (§4.5) sigue mejorando o empatando en todos los períodos (`npm run tope-crecida`).

**Qué más se probó** (`npm run prueba-pico`): predictores de «el pico ya pasó», sumados a la regresión de las cinco: cuánto bajó cada estación desde su máximo de los últimos 20 días, el cambio de Corrientes en 10 días, el de Rosario en 7, y la altura de Corrientes al cuadrado. A 14 y 17 días, ninguno mejora más de 2 % fuera de muestra, y no entran. En las crecidas parecidas a la de noviembre de 2026 (2013, 2014, 2023) Rosario siguió subiendo unos 60 cm en dos semanas, como dice el modelo. Tampoco sirvió no descontar la corrección «baja» cuando Rosario sube: empeora.

### 4.10 El cuadro de Prefectura del día

La serie del INA copia el cuadro de Prefectura con un día de atraso, y el modelo corría con lecturas un día más viejas de las que ya estaban publicadas. El 10 de noviembre de 2026, en plena crecida, usaba Rosario en 4,22 m y Paraná en 5,05 cuando el cuadro decía 4,30 y 5,20, y venía quedándose 11 cm corto a uno y dos días.

Desde ese día, antes de correr se le agrega a cada serie la lectura del cuadro (`conCuadro`). Los coeficientes, las bandas y los sesgos no cambian: es el mismo modelo corrido un día después, así que cada fecha se pronostica con un día menos de anticipación. Para una misma fecha, con todas las estaciones un día más nuevas (2022-2026, modelos sin lluvia ajustados en 2005-2021):

| Plazo | 3 d | 5 d | 7 d | 10 d | 14 d |
|---|---|---|---|---|---|
| Cambio en el error | −15 % | −13 % | −11 % | −16 % | −9 % |

Sólo se usa si el cuadro es del día siguiente al último de la serie y trae a Rosario y a las cinco estaciones; si no, corre con las series como vienen. Yacyretá no está en el cuadro y repite su último dato: su cambio en 3 días queda medido en 2, y con ECMWF desde 2024 la regresión pasa de 0,215 a 0,220 m a 14 días y de 0,265 a 0,272 a 17.

En la misma tanda se probó, sin mejora (entre 0 y −2 %): la tendencia propia de Rosario en 1, 3 y 7 días; corregir con el error del pronóstico emitido antes para el mismo plazo; sumar Diamante y Santa Fe; y el cambio en un día de las estaciones de arriba. Los cuadrados de las alturas de Rosario, Paraná y Corrientes dieron entre −2 y −6 % y quedan para un reajuste.

### 4.11 Rosario desde el hidrómetro automático, a 3 y 5 días

El cuadro de Prefectura con que corre el modelo es la lectura de la mañana anterior. El INA tiene en Rosario un hidrómetro automático (serie 29435, red SAT) que informa cada hora, un kilómetro aguas abajo de la escala y unos 5 cm por debajo. La variante nueva suma un predictor: cuánto cambió el automático entre las 8 de ayer y las 8 de hoy. Como es una diferencia, la escala no importa.

El automático empieza en julio de 2020, así que el ajuste (2005-2021) usa el mismo cambio leído en la serie de Prefectura un día después, que es la lectura de esa mañana: contra el automático, correlación 0,76 y 3,6 cm de diferencia media. El error, las bandas y los sesgos se midieron en 2022-2026 con el automático de verdad (`npm run ajuste-auto`):

| Días | Modelo | n | Error sin | Error con | Cambio | Banda 80 % |
|---|---|---|---|---|---|---|
| 3 | con las del medio | 1305 | 0,088 | 0,075 | −15 % | 27 → 24 cm |
| 5 | con las del medio | 1303 | 0,114 | 0,106 | −7 % | 36 → 33 cm |
| 3 | cinco estaciones | 1332 | 0,097 | 0,082 | −15 % | 28 → 24 cm |
| 5 | cinco estaciones | 1330 | 0,138 | 0,130 | −6 % | 42 → 40 cm |

El coeficiente del cambio es 0,85 a 3 días y 0,70 a 5. Sin automático, o con un salto de más de 60 cm en un día, sale el modelo sin él.

Quedó afuera: a 7 días mejora 2 % y desde 10 nada; y el mismo predictor con los automáticos de Paraná (29440) y La Paz (32631) dio entre 0 y +2 %.

### 4.12 Corrección no lineal, de 3 a 10 días

La regresión es una sola recta para todo el río. Dos cosas se le escapan. El río no responde igual bajo que alto: con Rosario en 1 m una onda llega antes y casi entera; con Rosario en 4 m se demora y se achata en las islas. Y cada plazo mira las estaciones de arriba con el retraso de su agua (a 10 días, Corrientes de hace 4) y no ve lo que hicieron ayer.

Para medir cuánto había para ganar se ajustó un modelo de árboles sobre el error de la regresión, con Rosario y las estaciones como están hoy. Lo que más usa es la altura de Rosario, en todos los plazos; después los cambios de Paraná en 3 y 10 días y el de Rosario en 3 (a 3 y 5 días), la altura de Corrientes (a 5 y 7) y el cambio de Corrientes en un día (a 10). Árboles de dos preguntas rinden lo mismo que los de cuatro niveles, y las cinco estaciones lo mismo que las ocho, así que quedó lo más chico: 150 árboles de dos preguntas por plazo, paso 0,1, hojas de 60 días o más (`npm run ajuste-correccion`, que trae su propio boosting, sin dependencias).

Dos mediciones, las dos fuera de muestra. La regresión sola, sin y con la corrección:

| Plazo | Ajuste 2005-2015, medición 2016-2021 | Ajuste 2005-2021, medición 2022-2026 (7 y 10: ECMWF desde 2024) |
|---|---|---|
| 3 | 0,073 → 0,070 m (−4 %) | 0,090 → 0,085 m (−5 %) |
| 5 | 0,094 → 0,086 m (−8 %) | 0,113 → 0,098 m (−13 %) |
| 7 | 0,108 → 0,099 m (−8 %) | 0,131 → 0,116 m (−11 %) |
| 10 | 0,140 → 0,140 m (0 %) | 0,169 → 0,157 m (−7 %) |

A 10 días la mejora es menos firme: aparece en 2022-2026 y no en 2016-2021. A 14 y 17 días la misma corrección mejoraba 2 a 5 % en 2022-2026 y empeoraba 5 a 12 % en 2016-2021, y quedó afuera.

Con el hidrómetro automático de Rosario (§4.11), en 2022-2026 con el automático de verdad: lo publicado pasa de 0,073 a 0,071 m a 3 días (−3 %) y de 0,103 a 0,093 a 5 (−10 %).

Con la corrección, los sesgos por régimen quedan entre −2 y +4 cm: ya ve cómo viene Corrientes. Como suma sobre la regresión y cada árbol devuelve un valor acotado, en una crecida que el ajuste no vio no se dispara: a lo sumo deja de corregir (sumando la peor hoja de cada árbol no llega a 1,5 m).

Probado en la misma ronda y descartado:

- Más predictores en la regresión (cambios de Rosario en 1, 3 y 7 días, el de Paraná en 1 día, Diamante, Santa Fe): 0 a 2 %.
- El error reciente del propio modelo como predictor: 0 a 2 %.
- Una regresión por tramo de altura de Rosario, o con interacciones con la altura: mejoraba en 2022-2026 y empeoraba en 2014-2021.
- Reajustar cada año con todo lo anterior en vez de dejar fijo el ajuste 2005-2021: 0,087 contra 0,089 m a 3 días, y parecido en el resto.
- Uniformar las fechas del INA. La hora con que el INA sella las lecturas cambia según la época (15 UTC en 2005-2012, 07 UTC en 2013-2015, 03 UTC desde 2017, y en Paraná y Corrientes distinto en 2006-2008 y 2010-2012), pero el retardo de cada estación contra Rosario es parejo en todas las épocas, y rearmar las series con una sola convención no mueve el error.

## 5. Limitaciones conocidas

- **Horizonte de 17 días:** las estaciones llegan a 14 y lo que suelta Yacyretá lo estira tres días más; a 21 días la banda ya es de un metro.
- **Linealidad:** de 3 a 10 días una corrección de árboles aprende lo que la recta deja (§4.12); a 14 y 17 días las crecidas y bajantes rápidas se corrigen con un sesgo por régimen, la mezcla con variaciones y un tope, que son parches. La corrección es menos legible que un coeficiente: se puede listar en qué se fija, no leer de un vistazo. Un evento sin precedentes en 2005-2021 puede quedar fuera de la banda.
- **Muestra corta para la lluvia:** la prueba con pronósticos reales cubre 2,6 años de días consecutivos, muy correlacionados entre sí.
- **Represas:** lo que se suelta en Brasil se ve recién cuando pasa por Yacyretá. Itaipú no agregó nada medible.
- **Puntos fijos para la lluvia:** no son cuencas delimitadas ni ponderadas por área.
- **Altura, no caudal:** el modelo trabaja sobre alturas de escala, no sobre caudales.
- **Lectura del mediodía:** Prefectura lee dos veces por día; a la tarde el cuadro trae la de las 12 y el modelo la toma como la de la mañana siguiente. No está medido cuánto pesa.

## 6. Preguntas abiertas

Donde más nos serviría una opinión especializada:

1. **Retrasos variables.** La velocidad de la onda depende del nivel y del caudal. ¿Conviene que el retraso Corrientes → Rosario varíe con el estado del río?
2. **Alturas o caudales.** ¿Mejoraría trabajar con caudales (curvas H-Q) en lugar de alturas, o con un modelo no lineal para las crecidas rápidas?
3. **Lluvia por cuenca.** ¿Qué delimitación y qué ponderación usarían para los afluentes del tramo (Salado, Feliciano, Guayquiraró, Corriente)? ¿Cómo entraría la humedad del suelo como lluvia efectiva? Tal como la probamos, no ayudó.
4. **Validación.** ¿Qué métricas o qué eventos de referencia usarían para comparar con otros modelos (por ejemplo, NSE o eventos de crecida concretos)?
5. **El pronóstico del INA como predictor.** ¿Tiene sentido usar el pronóstico oficial a 3-4 días como entrada de los plazos más largos?
6. **Caudales de las represas.** ¿Hay una forma mejor de usar lo que suelta Yacyretá, por ejemplo con tiempos de viaje que dependan del caudal, en vez de su cambio en 3 días?
7. **Datos que no estamos usando.** ¿Hay series abiertas de caudal, de afluentes o de embalses que deberíamos sumar?

Las respuestas, en los [issues](../../issues) del repositorio o por mail.

## 7. Atribuciones

Alturas y caudal de Yacyretá: Instituto Nacional del Agua, Sistema de Alerta Hidrológico de la Cuenca del Plata (CC BY 4.0), sobre lecturas de Prefectura Naval Argentina. Caudal de Itaipú: Operador Nacional do Sistema Elétrico (ONS), dados abertos (CC BY 4.0). Reanálisis: Hersbach et al. (2020), ERA5; Muñoz-Sabater et al. (2021), ERA5-Land, Copernicus Climate Change Service. Pronósticos: ECMWF IFS open data y NOAA GFS, vía Open-Meteo (CC BY 4.0).
