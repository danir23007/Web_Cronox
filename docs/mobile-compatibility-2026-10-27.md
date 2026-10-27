# Compatibilidad móvil de CRONOX — 27/10/2026

Estado: correcciones previas conservadas en local; fotografía del Xiaomi revisada; **apertura aparentemente ampliada todavía sin reproducir ni resolver**. Sin commit, push ni despliegue. Esta continuación añade diagnóstico, comprobaciones concretas y documentación, sin modificar código público. El diff de los archivos ya versionados coincide byte a byte con `output/playwright/mobile-followup/start.patch`, tomado al comenzar esta continuación.

Se partió de `main`, `d6a04e61`, con el footer ya en curso. La investigación previa se hizo en `../mobile-compat-review` y se integró conservando aquel trabajo. Los diffs de `store.css` y de la prueba móvil del footer siguen siendo los de esa tarea; en sus HTML se actualizaron versiones de recursos compartidos. El panel de administración no se ha modificado.

## Fotografía recibida: comparación con el círculo I

Se ha contrastado la fotografía ahora recibida con las capturas existentes del **círculo I**. No se copia a los artefactos ni se transcriben los datos personales visibles. Perspectiva, reflejos y cámara impiden comparar píxeles o tonos exactos con una captura del navegador.

| Síntoma de la foto | Evidencia y estado |
|---|---|
| Rectángulo claro detrás del CRONOX de la tarjeta; el de cabecera conserva fondo transparente | El wordmark original era completamente opaco y dependía de una matriz SVG para obtener transparencia. El recurso actual tiene alfa real y no utiliza ese filtro. El rectángulo **no apareció** en las capturas anteriores normales ni con Auto Dark: no se ha reproducido el fallo exacto del Xiaomi. Dependencia frágil eliminada; fallo de alfa/composición o recoloreado sigue siendo hipótesis, no una avería GPU/SVG confirmada. |
| Texto y borde blancos en etiqueta clara | El diseño del círculo I lleva fondo claro, texto oscuro y borde negro. Auto Dark sí alteró etiqueta/contraste y la corrección conserva esos colores en el modo probado. Pero la reproducción oscurece más el fondo y **no replica exactamente la foto**. Defecto de Auto Dark corregido en Chromium; atribución al modo/navegador concreto del Xiaomi pendiente. |
| Bordes muy luminosos en etiqueta, tarjeta y canto | La etiqueta negra y el contorno fino de la tarjeta difieren de la foto; compatible con recoloreado, sin probarlo. Los cantos, reflejos y capas claros del metacrilato forman parte del diseño. No todo borde claro es un defecto. Geometría preservada; color/composición final pendientes de ese dispositivo. |
| Línea bajo «ACREDITACIÓN» | Coincide con `.profile-tab.is-active { border-bottom: 2px solid #ffffff; }`: indicador intencionado de pestaña activa, conservado. Otras marcas de la fotografía no se atribuyen sin reproducción. |
| Sensación de tamaño grande | La foto no expone viewport, escala, ajustes de texto ni versión del navegador. Su interfaz inferior no lo identifica con certeza. No demuestra zoom, inflación de texto ni desbordamiento. |

Evidencia existente: [círculo I anterior con Auto Dark](../output/playwright/mobile-compat/compare-before-1-front-auto-true.png), [círculo I corregido con Auto Dark](../output/playwright/mobile-compat/compare-after-1-front-auto-true.png), [comparativa completa](../output/playwright/mobile-compat/comparativa.html). En el círculo I anterior, Auto Dark cambiaba el 22,02 % de los canales en más de 12/255; en el corregido, 0 % para ese modo. Son capturas locales, **no una medición contra la fotografía**.

## Zoom: verificaciones adicionales

Sin repetir la matriz anterior, se amplió el registro en Chromium y WebKit: emulación móvil 390 × 844, entrada por QR ficticio y entrada directa manteniendo consentimiento abierto siete segundos; observación hasta doce segundos, newsletter real, foco en email, rotación a 844 × 390, cierre, acceso y cambio a registro. Muestras cada 250 ms y ante eventos de foco, carga, viewport y fuentes. Las aserciones de estabilidad se aplican desde DOMContentLoaded; también se escucha antes, pero no se acredita cada fotograma ni un teléfono real.

| Motor / entrada | Muestras | Cierre de newsletter enfocado desde inicio del registro | Escala mínima/máxima | Desbordamiento horizontal máximo |
|---|---:|---:|---:|---:|
| Chromium / QR | 77 | 6,09 s | 1 / 1 | 0 px |
| Chromium / consentimiento abierto 7 s | 76 | 7,25 s | 1 / 1 | 0 px |
| WebKit / QR | 69 | 6,25 s | 1 / 1 | 0 px |
| WebKit / consentimiento abierto 7 s | 69 | 8,10 s | 1 / 1 | 0 px |

La demora configurada de newsletter sigue siendo 5,5 s; la tabla incluye carga/elegibilidad y espera de consentimiento. No se abre sobre el aviso de cookies. Al aparecer enfoca el cierre, no un campo: **esto ya ocurría antes**. Su email mide 16 px en vertical y horizontal. Se mantiene viewport único `width=device-width, initial-scale=1`, sin límites de escala. No aparece inflación espontánea demostrada ni desbordamiento. Los cambios de fuentes y foco se registran sin que la escala abandone 1.

Chromium también entrega muestras anteriores a DOMContentLoaded, desde unos 14 ms en la entrada QR: ya muestran escala 1 y anchos de 390 px. En estas ejecuciones WebKit no entrega muestras utilizables anteriores a ese evento. El `zoom` calculado de la raíz es 1 en ambos; Chromium expone `text-size-adjust:auto`, mientras WebKit no expone un valor en el acceso CSSOM utilizado (se registra `null`, no se presupone `auto`). Estas diferencias de observabilidad limitan lo que se puede concluir sobre los primeros instantes.

Comparación específica de `app.js` y `customer-typography.css` anteriores (`HEAD`) frente a actuales, manteniendo igual el resto del montaje, en ambos motores:

- Buscador horizontal: **14 px antes / 16 px ahora**. Se elimina la secuencia de rotar y enfocar un campo que se había reducido. Antes también había campos del perfil de 13–13,33 px. Que disparasen zoom de foco en el teléfono afectado sigue pendiente; no explica una ampliación anterior a tocar campos.
- Activación por teclado del cambio a registro: antes el foco queda en un control oculto; ahora pasa al cierre visible. Corrige foco, no demuestra causa de zoom. En ambas versiones emuladas la escala sigue en 1.
- `metacrilatos-profile.js` ajusta mediante CSS su sección a partir de 760 px; no cambia el viewport de toda la web. No hay evidencia para modificarlo como supuesto origen del incidente móvil vertical.

### Separación de mecanismos

Calibración en una página ficticia aislada, sin modificar CRONOX:

| Control deliberado | Layout (`clientWidth`) / contenido (`scrollWidth`) | Viewport visual | Texto de referencia |
|---|---|---|---|
| Normal | 390 / 390 px | 390 px; escala 1 | 16 px; glifos 79,13 px de ancho |
| Zoom CDP 2× | 390 / 390 px | 195 px; escala 2 | Sigue en 16 px y 79,13 px CSS |
| Aumentar solo fuente a 32 px | 390 / 390 px | 390 px; escala 1 | Glifos 158,23 px de ancho |
| Insertar contenido de 900 px | 390 / 900 px | 390 px; escala 1 en la muestra | `innerWidth` aumenta a 900 px |

No se usa `innerWidth` ni apariencia aislada para declarar zoom: se cruzan escala/ancho visual, layout, scroll y estilos/cajas de texto. La fuente de control verifica el instrumento, **no reproduce ajustes Android ni inflación automática**. Los mecanismos pueden coexistir. Teclado y barras físicos pueden cambiar altura sin zoom y no se reproducen con el teclado de escritorio de Playwright. Magnificación del sistema o zoom guardado pueden no exponerse como pinch en `visualViewport.scale`.

Referencias: [viewport visual de Chrome](https://developer.chrome.com/blog/visual-viewport-api) y [ajuste de texto, documentación histórica de Apple](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/AdjustingtheTextSize/AdjustingtheTextSize.html). No se ha añadido `text-size-adjust:none`, normalización global a `100%`, restricción `user-scalable`, `maximum-scale`, restablecimiento de zoom ni ocultación global de overflow. La prueba previa de escala CDP 2× permanecía en 2: no equivale a validar gestos físicos, especialmente sobre componentes con interacción táctil propia.

Resultados finales: `output/playwright/mobile-followup/zoom-results.json` y cuatro `timeline-*.json`. Antes del resultado final se corrigieron dos supuestos del montaje: configurar la API ficticia local y esperar/enfocar explícitamente el enlace en vez de asumir que un clic WebKit enfoca botones. No motivaron cambios públicos.

```powershell
# En otra terminal, desde la raíz:
node tests/mobile-compat/server.cjs
# Con el servidor activo:
node tests/mobile-compat/zoom-followup.cjs
```

El runner acepta `chromium` o `webkit` para repetir solo ese motor conservando evidencia del otro. La calibración y las comprobaciones de consentimiento/privacidad se ejecutan en Chromium. Todo utiliza datos ficticios.

## Validación física pendiente y voluntaria

El [procedimiento breve para el móvil afectado](mobile-zoom-device-check.md) recoge navegador/versión y ajustes de texto, pantalla, zoom y modo oscuro, más pasos antes/después de newsletter, foco, teclado y gesto de alejar. Comparar publicación y corrección local sin confundirlas.

[`voluntary-zoom-diagnostics.js`](../tests/mobile-compat/voluntary-zoom-diagnostics.js) es independiente de la web pública. Cargarlo no activa nada; `start()` pide consentimiento, mantiene medidas en memoria 30 segundos y permite parar/borrar/exportar voluntariamente. No recoge contenidos, valores, URL, tokens, identificadores DOM, cookies, almacenamiento ni User-Agent completo; no transmite ni guarda datos. No reutiliza el colector antiguo de tests, que incluía IDs/clases.

Comprobado en navegador: cero muestras antes de consentir o tras rechazar; ausencia de valores, identificadores y URL señuelo en el JSON; cero peticiones de red durante su uso; ninguna muestra nueva tras parar. La confirmación puede interrumpir momentáneamente el foco y el registro añade carga: no son medidas de rendimiento. Pegar el script después de cargar **no reconstruye la primera pintura**. La guía explica esta limitación y el consentimiento previo necesario para una sesión remota desde el inicio.

Pendientes: Xiaomi con navegador/ajustes reales, Chrome Android y Safari iOS físicos, zoom guardado, modo escritorio, tamaño de texto/pantalla e inversión/oscurecimiento. Son hipótesis, no causas declaradas. No se aplican nuevas correcciones especulativas.

## Correcciones previas conservadas

| Hallazgo demostrado | Corrección existente |
|---|---|
| Campos de 16 px solo hasta 600 px; horizontal volvía a 13–14 px. | `customer-typography.css` cubre también ausencia de hover y puntero grueso, independientemente de orientación. |
| Auto Dark alteraba fondos, bordes y contraste de acreditaciones. | `color-scheme: only dark` acotado a acreditación y `only light` en etiquetas y tarjeta clara IV. |
| Wordmark y ojo completamente opacos (708 × 307 y 1774 × 887); dependían de composición en ejecución. | 15 PNG RGBA derivados de originales, dimensiones/paletas conservadas; eliminados filtros SVG de logos y mezcla del ojo. |
| Foco oculto al cambiar formularios o fuera del modal tras consentimiento. | Recuperación condicionada, Tab/Mayús+Tab dentro del modal y Escape, sin robar foco a campos en uso. |
| Extracción Windows convertía referencias a CRLF y rompía hashes. | `.gitattributes` conserva bytes de referencias y LF del CSS generado; diseños aprobados intactos. |

Modo normal: diferencia media máxima de 0,022 niveles por canal sobre 255; ningún canal difiere en más de 12. Se mantienen contornos, dimensiones, caras y 68 paneles del canto. El ojo V reemplaza mezcla por una aproximación RGBA de su paleta; pequeña diferencia cuantificada, sin redibujar contorno.

Auto Dark se probó con CDP y preferencia oscura, como describe [Chrome DevTools](https://developer.chrome.com/docs/devtools/rendering/apply-effects). Cambios anteriores de 20,20–47,78 % de canales >12/255 pasan a 0 en ese modo. Forzar CDP con preferencia clara ignoró `only light`/`only dark` en este Chromium: **no se garantiza ningún algoritmo forzado de Mi Browser ni inversión del sistema**.

## Contexto histórico y caché

Evento 24/10/2026; entradas por QR o escribiendo/buscando cronox.es, según el usuario. Último commit principal anterior al 25: `8867cd12` (19/10), candidato histórico, no prueba de bytes recibidos por asistentes. Ya tenía viewport y foco de cierre de newsletter, pero no el archivo compartido actual de tipografía. No se dispone del QR exacto, ajustes/navegadores ni captura de red del evento.

Consulta de solo lectura del 27/10: HTML `no-store`, recursos `Cache-Control: public, max-age=0`. Bytes normalizados de `store.css?v=127`, `app.js?v=104`, `customer-typography.css?v=4` coincidían con `7952ed37`, no con HEAD local posterior. No se demuestra fallo de caché productivo. Nuevas versiones solo afectarán producción cuando se publique; no se ha publicado.

## Validación anterior conservada, no repetida ahora

| Comprobación | Resultado anterior |
|---|---|
| Regresión nueva integrada | 43 pasadas, 2 omitidas: Auto Dark CDP solo en Chromium. |
| Motores/tamaños | Chromium/WebKit móvil; Firefox viewport/táctil, sin afirmar Firefox Android. 320, 360, 375, 390, 412, 430; 844 × 390; 1440 y contextos de escritorio. |
| Superficies | Tienda, producto, quick add, cesta/drawer, checkout, perfil/acreditación, buscador, acceso/registro, newsletter, privacidad y footer. |
| Carga | Primera visita, QR, acceso directo, newsletter, fuentes tardías/fallidas, CSS/imágenes retrasadas, recarga y regreso. |
| Caché | Resource Timing: 44/44 assets de caché en Chromium y 34/34 Firefox; WebKit sin métricas equivalentes de tamaño. |
| Zoom/texto | Escala 1 en secuencias; CDP 2× mantenido; CSS `text-size-adjust:200%`. No sustituye preferencias/gestos físicos. |
| Apariencia | Cinco círculos, ambas caras, temas, Auto Dark, movimiento reducido y contraste forzado donde existe soporte expuesto. |
| DOM | 179 pasadas, 8 suites. |
| Renderer | 16 pasadas Chromium/WebKit: QR decodificables/no reflejados, geometría, instancias, recursos fallidos/recuperación. |
| Movimiento | 11 pasadas, 3 omitidas por condiciones/capacidades declaradas. |
| Checkout | 12 escenarios: 3 motores × 2 anchos × invitado/cuenta; proveedor simulado, validación/doble clic/rechazo/reintento. No acredita pagos reales. |
| Generador | Cinco hashes/longitudes aprobados y 19 outputs coinciden con `--check`. |
| Footer | Fila móvil sin scroll; alturas de escritorio exactamente iguales antes/después en tienda y sobre CRONOX a 1366, 1440, 1920. Trabajo previo preservado. |

Evidencia anterior en `output/playwright/mobile-compat/`: resultados finales `integrated-regressions.log`, `regression-results.json`, `jest.log`, `renderer-verified.log`, `checkout-regressions.json`, `footer-height-integrated.txt`. Logs de intentos iniciales se conservan y no representan el estado final.

## Archivos y reproducción

Esta continuación añade `tests/mobile-compat/voluntary-zoom-diagnostics.js`, `tests/mobile-compat/zoom-followup.cjs`, `docs/mobile-zoom-device-check.md`, y actualiza este informe, incluida su codificación UTF-8. Artefactos nuevos en `output/playwright/mobile-followup/`.

Se conservan: `customer-typography.css`, `app.js`, `metacrilatos.js`, `metacrilatos.css`, 15 PNG, generador, `.gitattributes`, HTML públicos/versiones de recursos, config/package/pruebas de compatibilidad y ajustes de pruebas existentes. Versiones locales: typography 5, app 105, store 128, renderer 9 y su CSS 4. Manifiesto de integración: `output/playwright/mobile-compat/integration-files.json`. Footer: `store.css`, `index.html`, `sobre-cronox.html` y su prueba DOM.

Para reproducir la validación anterior solo cuando nuevos cambios lo justifiquen: `npm run test:mobile-compat:browser` y `node metacrilatos-codex/extract-assets.cjs --check`. El servidor fixture escucha solo en localhost, utiliza datos ficticios y no conecta con base de datos ni pagos reales.
