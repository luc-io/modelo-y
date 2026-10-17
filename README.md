# Y

**Y** es un modelo estadístico de la altura del río Paraná en Rosario, de 3 a 14 días, hecho con datos abiertos. Es el que calcula el «escenario probable» de [alturario.hoy.net.ar](https://alturario.hoy.net.ar) para los días que el pronóstico oficial del INA no cubre.

**No es un pronóstico oficial.** El oficial es el del [Instituto Nacional del Agua](https://alerta.ina.gob.ar/a5/diario/reporte_diario), con un modelo hidrodinámico. Y es una regresión con retardos, más simple, y se publica siempre con su banda de error medida.

Publicamos el código y la metodología para que especialistas en hidrología lo revisen y lo critiquen. Las sugerencias van en los [issues](../../issues).

## Por qué se llama Y

*Y* es **agua** en guaraní, la lengua que les dio nombre a buena parte de los ríos de esta cuenca: *Iguazú* viene de *y guasu*, «agua grande». Se pronuncia como una vocal que no tenemos en castellano, entre la i y la u. Es corto a propósito: el modelo hace una sola cosa, mirar el agua que viene.

## Cómo funciona, en cinco líneas

1. El agua que va a pasar por Rosario ya está río arriba: Corrientes llega en 14 días, Goya en 11, Reconquista en 10, La Paz en 6 y Paraná en 3.
2. Para cada plazo (3, 5, 7, 10 y 14 días), una regresión lineal usa la altura de Rosario y el nivel y el cambio en 3 días de las estaciones que alcanzan, cada una con su retraso.
3. Desde 7 días suma la lluvia sobre los afluentes del tramo argentino entre Corrientes y Rosario: la de la última semana y la pronosticada por ECMWF.
4. Corrige el número por el sesgo medido según cómo viene Corrientes (subiendo fuerte, bajando o estable).
5. Lo publica con la banda p10–p90 del error, medida en años que el ajuste no vio.

El detalle, con todas las mediciones y lo que se probó y no sirvió, está en [METODOLOGIA.md](METODOLOGIA.md).

## Cuánto se equivoca

Error absoluto medio, fuera de la muestra de ajuste:

| Plazo | Sin lluvia (2022-2026) | Con lluvia ECMWF (desde feb-2024) |
|---|---|---|
| 3 días | 10 cm | — |
| 5 días | 15 cm | — |
| 7 días | 20 cm | 19 cm |
| 10 días | 21 cm | 19 cm |
| 14 días | 28 cm | 25 cm |

Sobre los mismos días desde febrero de 2024, la lluvia baja el error un 7 % a 7 días, un 11 % a 10 y un 8 % a 14.

## Reproducirlo

Hace falta Node 20 o más nuevo. Todos los datos se bajan de fuentes abiertas, sin claves.

```bash
npm install
npm run margen          # bandas y sesgos del modelo sin lluvia, 2022-2026
npm run ajuste-lluvia   # ajusta los modelos con lluvia e imprime la tabla antes/después
npm run prueba-lluvia   # prueba con lluvia perfecta (ERA5), 2022-2026
npm run prueba-pronostico  # la misma con pronósticos reales de ECMWF y GFS
npm run prueba-terminos    # qué hacer con la lluvia observada en vivo
```

Lo bajado queda en `.cache/`. El código del modelo está en `src/lib/`: `pronostico-rio.ts` (coeficientes, bandas, sesgos y la cuenta), `lluvia-tramo.ts` (puntos del tramo y lluvia típica) y `rio-historia.ts` (estaciones y series del INA).

## Datos

| Fuente | Qué | Licencia |
|---|---|---|
| [INA, Sistema de Alerta](https://alerta.ina.gob.ar/a5) | Alturas diarias de las estaciones del Paraná (copia del cuadro de Prefectura Naval) | CC BY 4.0 |
| [Open-Meteo](https://open-meteo.com) | ERA5 y ERA5-Land (archivo), pronóstico ECMWF IFS 0,25° y corridas anteriores | CC BY 4.0 |
| Copernicus Climate Change Service | ERA5 / ERA5-Land, vía Open-Meteo | Licencia Copernicus, con atribución |
| ECMWF | IFS open data, vía Open-Meteo | CC BY 4.0 |

## Licencia

El código, MIT. Los textos (este README y la metodología), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.es): se pueden citar y reusar con atribución. Para citarlo, ver [CITATION.cff](CITATION.cff).

## Origen

El modelo vive en el código de [hoy.net.ar](https://alturario.hoy.net.ar). Este repositorio es una copia de sus partes, que se actualiza cuando el modelo cambia. Si una sugerencia mejora el modelo, se mide igual que todo lo demás (ajuste 2005-2021, prueba fuera de muestra) y, si mejora, pasa a la página.
