# Previsión compartida y publicación — 2026-10-05

Este encargo reúne las correcciones pendientes de Quick Add, orden de filtros
NEW → DROP → GARMENT y previsión única de la cesta. Conserva el trabajo de SEO,
seguridad y categorías del commit `2d84409464da6cdc01fd428ad2cb1d2a1b6998ff`.
La decisión sobre ADMIN permanece pospuesta; no se modifican permisos, precios,
inventario, gastos de envío ni compromisos comerciales.

## Regla exacta

`cronox-front/assets/product-delivery.js` es la única implementación para ficha
y cesta. Obtiene la fecha del pedido en Europe/Madrid y suma tres días naturales.
Recorre desde el día siguiente al pedido hasta la entrega, inclusive, ampliando
el extremo un día por cada bloque de sábado/domingo y un día por cada fecha
festiva oficial. El recorrido incluye también la extensión. Cada fecha se visita
una vez y cada fin de semana se identifica por su sábado, incluso al cambiar de
año. Un festivo en sábado aporta su incremento además del bloque de fin de semana.
No se cuenta el día del pedido y no se desplaza automáticamente una entrega que
termine en domingo: **no es un cálculo de tres días laborables**.

Ejemplos en fecha de Madrid:

| Pedido | Entrega | Motivo |
|---|---|---|
| 05/10/2026 | 08/10/2026 | Tres días sin excepciones |
| 02/10/2026 | 06/10/2026 | Un único bloque sábado/domingo |
| 09/10/2026 | 14/10/2026 | Fin de semana y festivo del 12 |
| 28/04/2026 | 04/05/2026 | Festivos 1 y 2, más un fin de semana |
| 12/05/2026 | 17/05/2026 | Festivo local del 15; la extensión alcanza el sábado |
| 30/12/2026 | 04/01/2027 | Calendarios de ambos años; Año Nuevo y fin de semana |

La cesta utiliza esta misma fecha para todos sus artículos y cantidades: el
modelo actual no contiene plazos por SKU ni un calendario por destino/hora de
corte. No se añaden supuestos de ese tipo. Se conserva el texto estimado, punto
verde, tipografía y fecha actuales; una sola previsión y un separador antes de
las recomendaciones. Se oculta cuando está vacía o no hay datos válidos.

## Calendarios oficiales completos

El propietario confirmó el **05/10/2026** que se deben aplicar Comunidad de Madrid
y municipio de Madrid al origen de expedición. La configuración no identifica
ese municipio: esta elección explícita queda documentada aquí y en el módulo;
no se deduce del domicilio del comprador.

- **2026:** doce festivos del [Decreto 75/2025, BOCM 25/09/2025](https://www.bocm.es/boletin/CM_Orden_BOCM/2025/09/25/BOCM-20250925-16.PDF)
  y dos locales, 15 de mayo y 9 de noviembre, en el [calendario oficial municipal](https://www.madrid.es/portales/munimadrid/es/Inicio/Buscador/Calendarios-oficiales-laboral-y-de-dias-inhabiles-y-festivos-para-Madrid/?vgnextchannel=7db8fc12aa936610VgnVCM1000008a4a900aRCRD&vgnextoid=183083d071ed4710VgnVCM1000001d4a900aRCRD).
- **2027:** doce festivos del [Decreto 82/2026, BOCM 01/10/2026](https://www.bocm.es/boletin/CM_Orden_BOCM/2026/10/01/BOCM-20261001-19.PDF)
  y dos locales, 15 de mayo y 9 de noviembre, aprobados en el [Pleno del 29/09/2026, punto 21, página 4](https://sede.madrid.es/UnidadesDescentralizadas/UDCPleno/Actividad/Pleno/2026/2026-09-29/ficheros/E_RA_PO_29_09_2026.pdf).
  El acuerdo está firmado el 02/10/2026. El decreto incluye San José y el traslado
  de la Asunción al 16 de agosto: no se extrapola la lista de 2026.

Cada año contiene las catorce fechas aplicables; fuentes comprobadas el 05/10/2026.
Los calendarios están incorporados al script, sin consultas externas por visita.
**No hay un calendario verificado para 2028:** si el intervalo, incluida su
extensión, requiere ese año u otro no incorporado, ficha y cesta ocultan la
previsión en lugar de mostrar una fecha incompleta. Incorporar el calendario
oficial completo de 2028 y sus fuentes cuando se publique, antes de que las
estimaciones de finales de 2027 lo necesiten. No inventar sustituciones futuras.

## Preparación de publicación

El despliegue anterior terminó correctamente: [Actions 37317602316](https://github.com/danir23007/Web_Cronox/actions/runs/37317602316),
commit `2d84409`, también confirmado por SSH en el checkout del VPS. No había
otra publicación en curso antes de preparar esta entrega. Se utiliza el flujo
existente de push a `main`, sin force push, con exclusión mutua
`cronox-production` y comprobación del SHA esperado por SSH.

Se confirmó por SSH el destino configurado por el backend de producción:
`aws-1-eu-west-1.pooler.supabase.com:5432/postgres`. Se compararon **las 78**
migraciones del repositorio con `_prisma_migrations`: todas aplicadas, ninguna
pendiente o fallida. Este cambio no modifica el esquema ni necesita migración.
Antes de publicar se guardó una copia custom de PostgreSQL de 911.656 bytes en
`/home/deploy/cronox-backups/delivery-2026-10-05-1CQ4Ox/before-release.dump`;
`pg_restore --list` la validó. Carpeta 700 y copia 600, fuera del repositorio.
No se emplean reset, seed, db push ni restauración de datos.

Comandos del flujo real: `npm ci` en raíz y backend, `npm run prisma:generate`
en backend, `npm run admin:build` en raíz, `npm run build:compiled` en backend,
verificaciones de exportaciones, y script de publicación existente que ejecuta
`prisma migrate deploy`, compila y reinicia únicamente `cronox` mediante PM2.
No se actualizan dependencias ni se suben archivos .env, credenciales o copias.

Las verificaciones de calendario cubren fechas controladas, extensión, días DST
de 23/25 horas, festivos locales/regionales, coincidencias y falta de calendario.
Las regresiones de Quick Add incluyen imágenes y respuestas fuera de orden;
las de categorías incluyen nombres cambiados, visibilidad y grupos dinámicos.
Se comprueban ficha/cesta, escritorio/móvil y separación, además del catálogo,
filtros y galería. Los escenarios de cesta de producción deben usar simulaciones
solo en el navegador: no crear pedidos, cobros, envíos o cambios de inventario.

El resultado del workflow y las comprobaciones del commit efectivamente servido
se entregan con el cierre de publicación; el éxito del build local por sí solo
no acredita que esté publicado.

## Resultado local antes del push

- Instalaci?n reproducible ra?z/backend, Prisma Client 6.19.3 y builds Nest/Vite correctos.
- 74 suites frontend / 684 pruebas correctas. Exportaciones CI: 6 suites / 59 pruebas; comprobaciones de artefactos y rutas compiladas correctas.
- Base local 127.0.0.1:5433/cronox_dev: 78/78 migraciones, cero pendientes/fallidas; no se necesita aplicar ninguna.
- Navegador real localhost:3000, 1366 y 390 px: Quick Add sin cach?/red lenta/respuestas fuera de orden/cierre-reapertura y teclado de filtros correctos. Cat?logo real de siete productos y seis categor?as, sin simulaciones de cat?logo.
- Cesta an?nima exclusivamente local: uno/dos art?culos, cantidades, eliminaci?n del ?ltimo y reapertura; inventario antes/despu?s id?ntico, cesta final vac?a.
- Ficha y cesta en ambos tama?os coinciden para siete fechas controladas, incluida falta de calendario; un punto verde, una fecha, un separador. La comprobaci?n compartida utiliza cesta simulada solo en el navegador y bloquea peticiones HTTP de escritura.
- Cero errores JavaScript en estas comprobaciones. Los 401 de /api/me y favoritos corresponden a la sesi?n an?nima esperada.
- Solo se detuvo el backend local identificado (PID 16932, dist/main.js de este checkout), y se arranc? el build nuevo con start:local y proveedores desactivados.

Reproducci?n de la comprobaci?n compartida, en una sesi?n an?nima nueva:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=delivery-release open http://localhost:3000/tienda
npx --yes --package @playwright/cli playwright-cli -s=delivery-release run-code --filename tests/admin-review/delivery-release.browser.js
```

El mismo script permite verificar https://cronox.es despu?s de publicar, sin
operaciones de carrito en el servidor: no es una prueba de checkout ni de capacidad.
Capturas y registros se guardan en output/playwright/delivery-release-2026-10-05/,
ignorados por Git. El calendario es una estimaci?n comercial, no una garant?a de
entrega del transportista ni un cat?logo de festivos del destino.
