# Espaciado del footer de escritorio

Revisión local del 27/10/2026. El layout mantiene las pistas de logos/redes y newsletter y reparte con `space-evenly` los cuatro espacios alrededor de Soporte, Colabora y Legal. `footer-config.js` mide el ancho ocupado por el texto con `Range`, conservando sus saltos de línea, y lo comunica al CSS; los espacios se calculan en el layout. Solo cambia la posición horizontal de las tres columnas intermedias.

Archivos: `cronox-front/assets/store.css`, `assets/footer-config.js`, referencias versionadas en `index.html` y `sobre-cronox.html`. No requiere migraciones.

La comparación anterior frente al estado inicial comprobó altura del footer y geometría exacta de los extremos, tamaños de texto y distribución móvil sin cambios. Sus capturas y medidas permanecen localmente en `output/playwright/footer-spacing/verified.json`.

La prueba reutilizable `tests/footer/spacing.cli.js`, extraída de aquella medición, comprueba ambas páginas a 1366, 1440, 1920, 2560, 320, 375, 390 y 430 px, incluyendo cambios de ancho sin recargar. En la revisión final los cuatro espacios de escritorio difieren como máximo **0,03125 px**; no hay desbordamiento y funcionan los tres desplegables móviles. Opcionalmente admite `window.__footerBaseline` con las medidas anteriores para comparar también los extremos y toda la geometría móvil.

Para ejecutarla, servir `cronox-front` en `http://127.0.0.1:4173`, abrir una sesión Playwright CLI y usar `run-code --filename tests/footer/spacing.cli.js`. La prueba intercepta todas las APIs y bloquea destinos externos. Guarda capturas reproducibles bajo `output/playwright/`, fuera de Git.

Registrado únicamente en commits locales; sin push ni despliegue durante esta revisión.
