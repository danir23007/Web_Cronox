# Carrusel: alineación superior de productos — 08/10/2026

Corrección local terminada. Sin commit, push, despliegue ni modificaciones en producción. Se conservaron los cambios anteriores. No hay `AGENTS.md` en el repositorio ni en sus ascendientes; el archivo global disponible no contiene instrucciones. En este turno no había capturas adjuntas accesibles, por lo que la reproducción utilizó la vista real y recursos fotográficos locales.

La causa era `padding: clamp(70px, 9vh, 108px) 20px 36px` en `.gallery-lightbox__info`. No había título ni control encima de los productos que necesitase ese espacio: los controles del visor tienen posición fija y la descripción aparece después de las tarjetas. En escritorio 1440×1000 la regla añadía **90 px** antes del primer producto, tanto con uno como con tres productos.

`gallery.js` identifica el origen del visor mediante la clase `gallery-lightbox--carousel`, comprobando el contenedor del slide que lo abrió. La clase se conserva al navegar entre fotos y se vuelve a calcular al abrir otro visor. `gallery.css` aplica **20 px de padding superior**, coincidiendo con el margen lateral normal, únicamente a ese visor y desde 768 px. Se mantiene el padding lateral/inferior, el desplazamiento de la columna y las tarjetas. No se usan márgenes negativos, transformaciones ni cambios en el tamaño de la fotografía. En móvil permanece el padding superior de 30 px y el borde de 1 px entre fotografía y productos: separación medida **31 px**. La galería de mosaico conserva 90 px en el escritorio revisado y 30 px en móvil.

Caché: `gallery.css?v=20` y `gallery.js?v=17` en `index.html`, `gallery.html` y `admin.html`; expectativas de versiones actualizadas en las pruebas existentes.

Verificación en Chromium real con la página normal de **localhost:3000**, respuestas de galería simuladas y fotografías existentes de camisetas. Todas las peticiones API se interceptan localmente: no se escriben fotos, asociaciones, presencia ni ventas en la base de datos. Escritorio 1440×1000 y móvil táctil 390×844; tres fotografías de diferentes proporciones, uno/tres/uno productos y vuelta al inicio. Se comprobaron los enlaces `/producto/<slug>`, controles del visor, cierre y apertura posterior del mosaico. Las dimensiones y proporciones de todas las imágenes coinciden exactamente antes/después; cero errores JavaScript. Capturas inspeccionadas visualmente.

La primera reproducción se realizó antes de modificar los archivos y confirmó los 90 px. Para repetir y capturar la comparación sin el banner de consentimiento, el modo `before` de la revisión restaura la regla de padding anterior únicamente en la respuesta CSS interceptada del navegador; no cambia archivos ni datos. El modo `after` sirve los archivos actuales sin esa restauración. Ambos contextos tienen consentimiento rechazado y usan los mismos datos locales.

| Caso | Antes | Después |
| --- | --- | --- |
| Escritorio, un producto | [Captura](../output/playwright/gallery-spacing/before-desktop-one.png) | [Captura](../output/playwright/gallery-spacing/after-desktop-one.png) |
| Escritorio, varios productos | [Captura](../output/playwright/gallery-spacing/before-desktop-multiple.png) | [Captura](../output/playwright/gallery-spacing/after-desktop-multiple.png) |
| Móvil, un producto | [Captura](../output/playwright/gallery-spacing/before-mobile-one.png) | [Captura](../output/playwright/gallery-spacing/after-mobile-one.png) |
| Móvil, varios productos | [Captura](../output/playwright/gallery-spacing/before-mobile-multiple.png) | [Captura](../output/playwright/gallery-spacing/after-mobile-multiple.png) |

[Mediciones anteriores](../output/playwright/gallery-spacing/before-report.json) y [mediciones finales](../output/playwright/gallery-spacing/after-report.json).

**64 pruebas / 3 suites correctas** y sintaxis JavaScript correcta:

```powershell
npm test --prefix cronox-backend -- --runInBand src/frontend/gallery-carousel.dom.spec.ts src/frontend/gallery-page.dom.spec.ts src/frontend/admin-gallery.dom.spec.ts
node --check cronox-front/assets/gallery.js
```

Las pruebas de página emiten avisos de sus escenarios simulados de `fetch` ausente/API no disponible; las tres suites pasan. No se añadieron pruebas que duplicasen esta regla CSS: la comprobación de su efecto se hizo en el navegador.

Revisión visual reproducible con el backend local protegido funcionando:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=gallery open about:blank#before
npx --yes --package @playwright/cli playwright-cli -s=gallery run-code --filename=tests/gallery/spacing.cli.js
npx --yes --package @playwright/cli playwright-cli -s=gallery goto about:blank#after
npx --yes --package @playwright/cli playwright-cli -s=gallery run-code --filename=tests/gallery/spacing.cli.js
```

## Publicación y toque móvil

El espaciado se desplegó con `4ecb273` y el workflow 37788342263 terminó correctamente. Durante la revisión real en Chromium móvil, después de visitar la portada y cerrar la newsletter, se reprodujo otro fallo previo de interacción: `pointerup` abría el visor y el click táctil posterior se redirigía a `.gallery-lightbox__stage`, cuyo listener lo cerraba inmediatamente. La traza registra apertura y cierre en el mismo gesto; no era un fallo de cartografía ni carga de imagen.

Se exige ahora que la pulsación de fondo comience dentro del propio visor para poder cerrarlo. Se conservan Escape, botones, navegación, teclado y cierre voluntario del fondo. No se introduce otro plazo arbitrario. `gallery.js` pasa a v18 en portada, galería y administrador. La regresión DOM comprueba click residual y nuevo toque voluntario; 107 pruebas en tres suites pasan, así como ambos builds. Una repetición con el HTML y las fotografías reales publicados, sustituyendo únicamente el JavaScript por la corrección local, confirma que el click residual sigue llegando al stage pero ya no cierra el visor. La verificación posterior sin sustituciones se recoge en el informe de publicación.