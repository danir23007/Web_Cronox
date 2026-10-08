# Cartografía del administrador CRONOX

## Provincias — ampliación del 08/10/2026

Fuente provincial: elaboración CRONOX con datos del **Instituto Nacional de Estadística (INE)** distribuidos por geoBoundaries gbOpen ESP ADM2, `ESP-ADM2-93216281`, revisión fijada `9469f09`. Incluye 50 provincias y Ceuta/Melilla. Datos representados: 2018; última actualización de la fuente: 19/01/2023; compilación: 12/12/2023; descarga: 08/10/2026.

- [Metadatos del distribuidor](https://www.geoboundaries.org/api/current/gbOpen/ESP/ADM2/), conservados en `province-source-metadata.json`.
- [GeoJSON simplificado original](https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/ESP/ADM2/geoBoundaries-ESP-ADM2_simplified.geojson), guardado sin cambios en `spain-provinces.geojson`.
- SHA-256: `40a12d32651a352b59bc88447432421ab80e2d950deb6f552efbae907f7232c2`.
- Licencia: **National Institute of Statistics (INE) Data License**, según los metadatos, con condiciones de reutilización del [aviso legal oficial del INE](https://www.ine.es/ss/Satellite?L=0&c=Page&cid=1254735849170&p=1254735849170&pagename=Ayuda%2FINELayout). Permite reutilización comercial y no comercial con atribución y fecha de actualización, preservando el sentido de los datos y sin sugerir respaldo del INE. Resumen local en `PROVINCES-LICENSE.txt`. Esta fuente provincial tiene su propia licencia; `LICENSE.txt` (CC BY 4.0) corresponde a las comunidades.

Adaptaciones: proyección y redondeo reproducibles del script común, asociación explícita con los 52 códigos INE y nombres de `spain-geography.ts`, recuadros de Canarias/Ceuta/Melilla. Península y Baleares comparten posición relativa y escala. Las dos provincias canarias comparten el recuadro y su escala, conservando la posición de sus islas. Todos los polígonos y anillos originales se conservan en un único grupo SVG por provincia: islas, datos, color, foco y selección permanecen vinculados. Los recuadros interactivos ampliados de Ceuta/Melilla no se superponen a provincias vecinas. ADM2 solo contiene la ciudad de Melilla; la banda de islotes de ADM1 no se añade a esta fuente ni se inventan límites. Generar ambos SVG sin red con el comando descrito abajo. Recursos servidos localmente por Nest e incluidos en `admin:build`, sin dependencias cartográficas remotas en el navegador.

## Comunidades autónomas

Fuente: Instituto Geográfico Nacional, distribuida por [geoBoundaries](https://www.geoboundaries.org/), conjunto gbOpen ESP ADM1, identificador `ESP-ADM1-25490228`.

- Licencia: **Creative Commons Attribution 4.0 International (CC BY 4.0)**. Texto completo en `LICENSE.txt`; [licencia oficial](https://creativecommons.org/licenses/by/4.0/).
- Datos representados: 2017. Actualización de la fuente: 19/01/2023. Compilación geoBoundaries: 12/12/2023. Descarga de CRONOX: 07/10/2026.
- [Metadatos del distribuidor](https://www.geoboundaries.org/api/current/gbOpen/ESP/ADM1/), conservados en `source-metadata.json`.
- [GeoJSON simplificado original, revisión fijada 9469f09](https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/ESP/ADM1/geoBoundaries-ESP-ADM1_simplified.geojson), guardado sin cambios como `spain-communities.geojson`.
- SHA-256 del GeoJSON: `b61a1bf661b90883763f633f5e9dbc27e7356309e42cbe56b60d2ceab5112f63`.
- Referencia: Runfola, D. et al. (2020), *geoBoundaries: A global database of political administrative boundaries*, PLoS ONE 15(4): e0231866. https://doi.org/10.1371/journal.pone.0231866

Adaptaciones CRONOX: el script `cronox-backend/scripts/build-admin-map.cjs` asocia los nombres originales a los 19 códigos INE, proyecta los contornos en un SVG local mediante una proyección equirectangular con paralelo de referencia de 40°, redondea las coordenadas de pantalla a dos decimales y añade interacciones accesibles. No elimina polígonos ni dibuja límites ficticios.

La Península y Baleares comparten escala y posición relativa. Canarias, Ceuta y Melilla aparecen en recuadros independientes con su nombre. La fuente agrupa algunos islotes españoles alejados dentro de la entidad de Melilla; se conservan en una banda inferior a otra escala, mientras la ciudad se amplía en la parte superior. Esta adaptación se explica bajo el mapa. El mapa es una visualización estadística de límites simplificados, no cartografía catastral ni de navegación.

Regenerar sin red:

```powershell
node cronox-backend/scripts/build-admin-map.cjs
```

La aplicación carga únicamente el SVG local. Los enlaces de atribución no originan peticiones hasta que el usuario los abre. No hay teselas remotas, SDK, claves, cookies cartográficas ni servicios de pago.

La correspondencia entre las 52 provincias y las 19 comunidades/ciudades se contrasta con la [tabla oficial del INE](https://www.ine.es/daco/daco42/codmun/cod_ccaa_provincia.htm) y vive en `cronox-backend/src/admin/map/spain-geography.ts`.
