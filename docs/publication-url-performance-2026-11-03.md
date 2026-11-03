# Publicación acotada de URL y rendimiento — 03/11/2026

Autorización: publicar exclusivamente ARMORED COAL/SEO y rendimiento. Se conserva el trabajo local completo en `work/cronox-url-performance-20261103`. La rama `release/cronox-url-performance-20261103` avanza el historial sin force-push, con compensaciones explícitas para que los cambios anteriores no autorizados no lleguen al cliente.

## Alcance previo al despliegue

La base funcional productiva comprobada es `18260856c805916eede0136a6e7334198eae4a8a`. Main contenía seis commits posteriores. Permanecen en el historial, pero sus diferencias se excluyen de esta publicación: documentación de la incidencia, exclusión de artefactos, eliminación administrativa con participaciones QR, ajuste de espacios del pie, regresión del checkout y retirada del aviso de presencia. El código administrativo, pie compartido y checkout de la revisión candidata se comparan contra la base productiva, no solo contra el último main.

`720afaf5` oculta únicamente «Artículos reservados mientras permanezcas en el checkout» cuando la reserva está lista, y actualiza la versión del script. No altera la adquisición de reserva, los plazos ni los mensajes de pago iniciado/caducidad/error. Se conserva en local; en esta publicación sigue el aviso actual de producción. `0ef19ea7` añade una regresión y documentación, sin comportamiento de cliente. Tampoco se incorpora su archivo nuevo a la revisión publicada.

Los commits de URL/rendimiento son `d50bfe30` y `e655d256`. Los recursos minificados de publicación se regeneran desde las fuentes acotadas: por ejemplo, el CSS no incorpora el ajuste anterior de espacios del pie. No se modifica el controlador privilegiado ni el workflow. Push ejecuta CI; después se solicita un único `workflow_dispatch publish=true` sobre el SHA exacto verificado de main.

## Datos e imágenes

Preflight de producción: producto 4 = ARMORED COAL, slug anterior, 6500 céntimos; slug nuevo libre. Historial íntegro de 109 migraciones y solo `20261103090000_armored_coal_slug` pendiente. El controlador habitual exige detener escritores y crear/restaurar/comparar un respaldo recuperable antes de instalar y migrar.

Plan de Storage preparado sin mutaciones: ocho galerías sin preview y 125 WebP públicos con rutas hash y cabecera incompleta, 51.967.138 bytes. Copia privada en el VPS, fuera del checkout: `/home/deploy/cronox-images-backup-20261103`, permisos 700/600, bytes originales y metadatos, manifiesto SHA-256 `c91f61824e59a6315a7bad6557c8f4814c5fafaf5f9d5e72c115e634c0387a09`. No se incluyen esos archivos en Git.

`scripts/maintain-storefront-images.cjs` admite plan/execute/verify/restore-cache, límites de 30 galerías/200 objetos, proyecto fijo, comprobación de copias y estado concurrente. Repara caché por PUT soportado conservando bytes, MIME, encoding y metadatos propios; no modifica tablas internas de Storage por SQL. Solo añade preview a los JSON de galería mediante comparación del valor anterior; conserva grid/large, URL original, dimensiones y demás campos. La restauración de caché usa las copias; para revertir preview, el plan conserva el JSON anterior y el esperado, que deben compararse antes de restaurar la fila. Los nuevos objetos pueden quedar sin referencias sin borrar originales ni ampliar el alcance de la operación.

Fuentes: [actualización de Storage](https://supabase.com/docs/reference/javascript/storage-from-update) y [caché de CDN y navegador](https://supabase.com/docs/guides/storage/cdn/smart-cdn). La propagación de CDN puede tardar; verificar tanto metadatos como GET/HEAD públicos después.

## Verificación preparada

Compilación equivalente a producción y tipos correctos. 185 pruebas Jest focales en 12 suites; tres pruebas del mantenimiento acotado. Las comprobaciones anteriores de navegador/checkout simulado constan en los informes de cada trabajo. El CI obligatorio ejecutará además su batería completa sobre la revisión exacta. Las mediciones públicas y comprobaciones finales se documentarán tras publicar, sin crear pedidos, pagos, suscripciones ni alterar stock.
