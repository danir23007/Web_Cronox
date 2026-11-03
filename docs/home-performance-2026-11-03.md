# Portada: rendimiento y verificación local — 3 de noviembre de 2026

**Actualización posterior:** publicado y verificado en producción. Las mediciones públicas, Storage completado, alcance acotado y cierre están en [el informe de publicación](publication-url-performance-2026-11-03.md). Los resultados y pendientes que siguen describen el estado al terminar la fase local, no el estado final de producción.

Trabajo local, sin push, despliegue, cambios de datos en producción, compras ni pagos reales. Se conservaron los cambios anteriores de ARMORED COAL y SEO. No se modificó el diseño, los textos de marca, la tipografía ni las reglas de consentimiento/newsletter.

## Qué se comprobó

- El informe histórico de PSI (móvil 66, escritorio 99, FCP 3,3 s, LCP 13,6 s, SI 4,6 s, TBT 0, CLS 0, 4.411 KiB) no es la referencia numérica de esta comparación. No contenía datos de usuarios reales.
- La versión actual ya retira el preloader tras DOMContentLoaded y dos frames; no espera `window.load`, imágenes inferiores ni un tiempo mínimo artificial. Se conservan la transición de salida y la limpieza a los 600 ms. El problema restante es que los scripts diferidos y las hojas de estilo deben llegar antes de ese evento.
- El preloader original tiene 81 fotogramas, 2.430 ms, bucle infinito y transparencia. La variante de 640 px pesa 1.410.798 bytes para unos 196 px efectivos (incluidas las transformaciones), aunque el ancho CSS base sea 160 px.
- Las tarjetas solo ofrecían `card` (975 × 1300), pese a existir `small` (450 × 600). `srcset` con un único candidato no puede elegir una foto pequeña. La galería ofrecía `grid` (1500 × 2000), sin miniatura intermedia.
- El observador horizontal del carrusel no basta para diferir una sección situada debajo de la pantalla. Además, su posición inicial cambia cuando termina de aparecer el catálogo.
- GET público de `assets/app.js?v=105`, con `Accept-Encoding: gzip`: HTTP 200, sin `Content-Encoding`; los recursos estáticos mantienen `max-age=0`. La comparación final usa también recursos sin compresión HTTP.
- Las respuestas reales de las imágenes gestionadas de Supabase contienen **`Cache-Control: public, 31536000`**. Falta `max-age=`: el número suelto no establece el TTL pretendido. El código enviaba directamente los segundos como cabecera REST, confundiendo ese formato con la opción del SDK.

## Cambios

1. **Animación ligera y adaptable.** `optimize-storefront-preloader.cjs` genera `CRONOX-preloader-v2-{208,400,640}.webp`, calidad 85, alfa 100. Pesan 90.760, 260.710 y 627.374 bytes. Se verifican automáticamente fotogramas, duración, bucle, transparencia y proporciones. La versión móvil habitual de 400 px reduce el archivo un **81,5 %** frente a la anterior de 640. Se mantienen el original y las variantes antiguas para otras páginas/histórico. No se introduce una espera para terminar la animación.
2. **Logos.** Dimensiones explícitas 680 × 307 para cabecera/pie y 64 × 64 para los tres SVG sociales, respetando sus proporciones. El pie reutiliza el WebP sin pérdida ya existente en la cabecera.
3. **Tarjetas.** Se ofrecen `small` y `card`. `sizes="auto, …"` permite al navegador usar el ancho real en imágenes lazy; conserva una alternativa para navegadores sin ese soporte. Se establece `loading` antes de las fuentes. Ficha, zoom, carrito y checkout mantienen sus roles y resoluciones.
4. **Galería.** La portada espera a que el catálogo resuelva su estado (también vacío/error) y a que la sección se acerque a 200 px del viewport. El carrusel mantiene su observación horizontal. El cálculo de `sizes` considera el tamaño pintado, recorte y zoom configurado, y se actualiza al redimensionar. Nueva variante `preview`, lado máximo 960 px y calidad 92, para futuras subidas; `grid`, `large` y originales se conservan. En una foto vertical 3:4, el preview es 720 × 960.
5. **Caché.** Las nuevas subidas REST de imágenes públicas identificadas por hash envían `Cache-Control: max-age=31536000`; `x-upsert:false` se conserva. Una sustitución con contenido diferente recibe otra URL; una repetición idéntica conserva la URL. Las cabeceras de objetos antiguos no cambian por desplegar este código ni por recibir un 409 al intentar subirlos otra vez.
6. **Minificación de producción.** `npm run storefront:build`, integrado en el `admin:build` que ejecuta el despliegue existente, genera `app.min.js`, `products.min.js`, `gallery.min.js` y `store.min.css`, con versión de contenido en la URL. Fuentes legibles conservadas; esbuild 0.27.2 declarado y fijado. Aproximadamente 331 → 194 KiB sin compresión entre esos cuatro archivos. No se carga código de interacción bajo demanda ni se elimina ninguna función.

El formato REST está contrastado con el [código oficial de Supabase Storage](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts), que añade `max-age=` al enviar un cuerpo binario. La [documentación de subidas](https://supabase.com/docs/guides/storage/uploads/standard-uploads) recomienda nuevas rutas al sustituir contenido para evitar versiones antiguas en caché.

## Método y evidencia

- Copia previa congelada en `output/performance-20261103/before/cronox-front`; incluye los cambios previos del repositorio. No se usó `git reset` ni se reconstruyó una referencia distinta a la encontrada.
- Plantillas y middleware SEO compilados de Nest, con el frontend de producción. Servidor aislado `tests/performance/server.cjs`, sin conexión a bases de datos, secretos o pagos. Las lecturas públicas se capturan una vez; imágenes servidas desde una copia local de los mismos bytes y cabeceras. Los límites de sesión/carrito son simulaciones locales. No se usan datos de clientes.
- Lighthouse 13.6.0, Chromium 153 de Playwright, Windows. Throttling DevTools real: móvil 412 × 823, DPR 1,75, latencia 150 ms, descarga 1.600 Kbit/s, subida 750 Kbit/s, CPU ×4. Escritorio 1366 × 768, DPR 1, latencia 40 ms, descarga/subida 10.240 Kbit/s, CPU ×1.
- Tres pares fría/repetida por dispositivo y versión, navegaciones seriadas. Cada par comienza en un navegador nuevo; la segunda conserva caché/almacenamiento. El aviso de cookies permanece visible en ambas mediciones Lighthouse: no se acepta ni rechaza durante ellas. Se comprueba por separado la visita posterior con rechazo recordado.
- Sin compresión HTTP en ambas versiones. Mismas instantáneas públicas y condiciones. No se simula la corrección de cabeceras de imágenes antiguas ni un backfill ya desplegado: los resultados «después» corresponden al código nuevo con los datos públicos existentes.
- Limitaciones: servidor y medios en loopback, sin DNS/TLS/CDN remoto ni latencia del backend real. El navegador aislado bloquea la imagen de reserva de newsletter incrustada en JavaScript (10.646 bytes; GET/HEAD público 200, no es un fallo de producción) y cancela un intento remoto de la imagen del hero al sustituirlo por la copia local. Esas condiciones son idénticas antes/después; los bytes son del escenario medido, no el total garantizado de producción. La comprobación visual adicional sí refleja esas URLs públicas mediante el servidor local. La puntuación no predice el siguiente PSI ni la experiencia real de todos los clientes. Los resultados preliminares con otra configuración se sustituyeron por la serie final común.
- `measure.cjs` guarda LHR, trazas y eventos de red. Lighthouse restaura el viewport al terminar: para comparar imágenes se utilizan su `final-screenshot` y las capturas de `experience.cjs`, no la captura auxiliar posterior al audit. `summarize.cjs` extrae medianas y esos fotogramas.
- Se mide tanto el evento que inicia la salida como la retirada completa del overlay. La retirada es una medida conservadora: el contenido empieza a verse durante la transición. La disponibilidad del manejador del menú y su apertura efectiva se comprueban por separado, después de rechazar cookies, sin introducir un clic que corte anticipadamente la medición LCP.

## Medianas finales (tres mediciones por fila)

Tiempos FCP/LCP/SI/overlay en segundos, TBT en milisegundos y transferencia en KiB. «Repetida» conserva la caché del mismo navegador, sin quitar el aviso de cookies entre las dos mediciones.

| Dispositivo / visita | Versión | Puntuación | FCP | LCP | SI | TBT | CLS | KiB | Overlay retirado |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Móvil / fría | Antes | 89 | 2,28 | 2,98 | 4,49 | 84 | 0 | 3.288 | 6,32 |
| Móvil / fría | Después | 95 | 1,84 | 2,47 | 3,60 | 80 | 0 | 1.098 | 5,04 |
| Móvil / repetida | Antes | 100 | 0,75 | 1,07 | 1,35 | 56 | 0 | 2.342 | 2,00 |
| Móvil / repetida | Después | 100 | 0,82 | 1,05 | 1,29 | 58 | 0 | 437 | 1,89 |
| Escritorio / fría | Antes | 100 | 0,38 | 0,50 | 1,06 | 1 | 0 | 3.984 | 1,66 |
| Escritorio / fría | Después | 100 | 0,39 | 0,47 | 0,85 | 0 | 0 | 961 | 1,37 |
| Escritorio / repetida | Antes | 100 | 0,32 | 0,32 | 0,61 | 0 | 0 | 2.827 | 1,09 |
| Escritorio / repetida | Después | 100 | 0,32 | 0,32 | 0,56 | 0 | 0 | 330 | 1,02 |

La mejora principal es la primera visita móvil: **1,28 s menos hasta retirar totalmente el overlay (20,3 %)** y **66,6 % menos transferencia** en este escenario. La visita repetida mejora menos en tiempo. No todos los valores bajan: FCP móvil repetido sube unos 70 ms y TBT unos 2 ms; FCP de escritorio frío sube unos 9 ms. Son tres muestras de laboratorio, no una prueba estadística de mejora universal. CLS permanece en cero.

### Elemento LCP y cronología comprobada

- En **las doce navegaciones móviles** (antes/después, fría/repetida), el LCP final es `p#cronox-consent-description`, el texto del aviso de cookies. No tiene una descarga de imagen asociada. En la primera pareja fría, el HTML termina a 317/314 ms, la fuente normal latina descarga de 238–1.080 / 213–1.088 ms y el texto LCP se pinta a 2.992/2.464 ms (PerformanceObserver). Las medianas Lighthouse están en la tabla.
- En **las doce navegaciones de escritorio**, el LCP es `#hero img.hero-video`. Primera pareja fría: inicio/fin de descarga 68/465 ms y pintura 536 ms antes; 92/448 ms y pintura 468 ms después. Son los mismos bytes del hero, sin reducir su calidad.
- El preloader no es el LCP final de estas pruebas. En la primera navegación móvil fría solicita el archivo antiguo a 244 ms y lo **cancela** a 6.315 ms al retirarlo; recibe unos 307 KB parciales. La nueva variante de 400 px se solicita a 219 ms y también se cancela al retirarse, a 5.017 ms, con unos 232 KB parciales. No se confunde cancelación con descarga completa ni se atribuye a la compresión del logo todo el ahorro de transferencia. La animación no se convierte en una condición para entrar.
- La marca de inicio de salida y la retirada del overlay confirman que la mejora alcanza al contenido de la tienda; el LCP, por sí solo, lo habría dado por visible bastante antes. Las pruebas de interacción comprueban que el menú abre al primer toque después del consentimiento y que catálogo, ficha, talla M, quick add y carrito responden.

Evidencia local: `output/performance-20261103/summary.json`, 24 archivos `*.lhr.json`, sus trazas/red y capturas, más las comprobaciones de experiencia y prioridad. Los datos completos permiten distinguir el tamaño de un archivo de los bytes efectivamente recibidos.

## Recomendaciones no aplicadas

- **Prioridad alta del preloader:** experimento alternado con tres visitas frías por opción. Mediana inicio de salida: automática 4.363 ms, alta 4.379 ms; hero descargado: 4.513 frente a 4.521 ms. Un único request del preloader en los seis casos. Sin ventaja demostrable; no se añade. El hero conserva su prioridad alta existente.
- **Preconexión a Supabase:** el origen sí aparece temprano en el hero, pero la copia local no reproduce su negociación DNS/TLS. No se añade una conexión especulativa sin una comparación remota válida; no se contabilizan los 300 ms estimados como ahorro conseguido.
- **Borrar “no usado”:** se conservan autenticación, categorías, favoritos, tallas, quick add, carrito, galería ampliada, newsletter, cookies y sus estilos. La cobertura de una portada recién abierta no demuestra que sobren. No se suman las estimaciones solapadas de PSI.
- **Separar CSS/JS por interacción:** no se introduce un cargador ni se retrasa la respuesta al primer toque. Se mantiene la cadena de estilos y la tipografía; se reduce el volumen con minificación y se comprueba el resultado. `api.js` ya es un archivo generado y minificado desde `src/admin/api.ts`; no se edita a mano.

## Pruebas

- `npm run build:compiled` en backend y `npm run storefront:build`: correctos.
- Jest: 58 pruebas en cinco suites de resolución de imágenes, procesado, almacenamiento y backfill. Incluyen cabecera válida, URLs distintas al sustituir contenido y dimensiones preview/grid/large.
- Navegador: selección real 450/720 px y posterior ampliación grande; ninguna descarga adicional de `card/grid` en esa prueba. Primera visita, cookies recordadas, primer toque del menú y acercamiento a galería.
- Galería: 12 casos Chromium (móvil/escritorio, mosaico/carrusel, recarga, visor, vacío y reintento). Fixtures antiguos se ajustaron al contrato actual de favoritos/categorías y a la nueva carga al aproximarse.
- Flujos: 11 casos seleccionados de carrito, favoritos, newsletter e imágenes secundarias. El caso de promesas compartidas se hizo determinista iniciando explícitamente una actualización pendiente; ya no depende del tiempo de `window.load`.
- Móvil: 2 casos de primera visita/newsletter/foco/recarga/retorno y recursos lentos/fuentes fallidas/texto ampliado.
- Checkout: escenario vigente de reservas de stock en 390 y 1366 px, invitado/cuenta, preparación, doble clic, rechazo simulado, reintento y recarga conservando reserva/dirección. Todas las APIs y Stripe interceptados; cero pagos reales. El escenario antiguo no incluía la respuesta de reserva y se sustituyó por el escenario actual del repositorio.
- Comparación visual de portada/catálogo móvil y escritorio y del fotograma metálico del preloader; originales y fotos ampliadas conservados. Se separan capturas de carga de fotos parcialmente recibidas y capturas con descarga completa. Una foto pública real procesada con el servicio compilado produjo preview 720 × 960 / 53.378 bytes frente a grid 1499 × 2000 / 282.126 bytes; se compararon a 297 CSS px y DPR 2. No se subió ese derivado ni se cambió su registro.

## Pendiente de producción

1. Revisar y desplegar por el proceso habitual cuando se autorice, incluyendo los archivos generados y las tres nuevas animaciones. No se ha hecho en esta tarea.
2. Para galerías existentes, revisar `npm run images:backfill -- --dry-run --batch-size=5 --concurrency=1` en el entorno operativo adecuado y, tras revisar el informe, ejecutar el modo `--execute`. El procedimiento existente conserva originales, trabaja por lotes, omite metadatos completos y ahora reconoce `preview`. Las páginas siguen usando `grid` si el preview todavía no existe. No se ejecutó contra producción.
3. Corregir mediante una operación soportada de Storage la metadata `Cache-Control` de los objetos públicos antiguos, o publicar derivados con rutas versionadas nuevas. Verificar GET, ETag/URL, TTL y sustitución desde el administrador. **El 409 de una ruta hash existente no repara su cabecera.** No actualizar directamente tablas internas de Storage ni sobrescribir fotos distintas bajo una URL que se pretenda inmutable.
4. Evaluar gzip/Brotli en Nginx para texto (HTML/CSS/JS), con `Vary: Accept-Encoding` y verificación de respuestas. No volver a comprimir WebP. Este ajuste de alojamiento no está aplicado ni incluido como ahorro en las mediciones.
5. Tras el despliegue y, en su caso, el backfill, repetir PSI y la inspección de red en móvil real. Revisar datos de campo cuando existan. No se promete una puntuación, indexación ni mejora de posicionamiento.

## Reproducir

Instalar herramientas aisladas: `npm install --prefix output/performance-20261103/tooling --save-exact --no-audit --no-fund lighthouse@13.6.0`. El directorio de evidencia está ignorado por Git y permanece local.

Compilar backend; usar `PERF_VERSION=before` para la copia congelada o `after` para el frontend actual y ejecutar `node tests/performance/server.cjs` en 4186. En otra terminal: `node tests/performance/measure.cjs before` o `after`; después `node tests/performance/summarize.cjs`. No sobrescribir la copia previa con la versión optimizada. `experience.cjs` y `priority-probe.cjs` guardan evidencia adicional.

Regresiones: `npx playwright test --config playwright.performance.config.cjs`; `playwright.gallery.config.cjs --project chromium`; la selección de flujos está en `playwright.performance-flows.config.cjs`. Los servidores de pruebas no reenvían escrituras a CRONOX.
