# Cartografía del administrador CRONOX

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
