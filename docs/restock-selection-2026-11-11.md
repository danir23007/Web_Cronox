# Avísame: hover y tallas con avisos persistentes

Trabajo local sin commit, push, despliegue ni escrituras en producción. Se conservan los cambios pendientes anteriores de Puntos de venta.

El botón compartido de tarjetas agotadas conserva tamaño, borde y tipografía. Solo el botón sube 2 px y cambia a negro/blanco, con transición de 160 ms. Se desactiva el movimiento anterior de la tarjeta agotada completa, para no sumar su desplazamiento al del botón. Los hover se limitan a dispositivos con ratón fino; las transiciones respetan `prefers-reduced-motion`.

El popup mantiene dos conceptos independientes: la talla sobre la que se actúa y el mapa de avisos confirmados. `aria-pressed` y el negro/blanco dependen exclusivamente de ese mapa, por lo que varias tallas quedan activas a la vez. Abrir consulta mediante los GET existentes todas las variantes del producto, incluidas las que hayan recuperado stock. No se guarda la selección en almacenamiento del navegador. El resumen de tallas y «Este aviso no reserva la prenda.» permanecen debajo de los recuadros.

Pulsar una talla sin aviso conserva el POST existente y solo la marca cuando el servidor confirma la suscripción. Pulsar una talla activa muestra la acción existente «Cancelar aviso», con su talla identificada en el nombre accesible. Solo un DELETE confirmado retira esa talla. Un error de escritura vuelve a consultar el estado real sin inventar un alta ni una baja; si falla también esa consulta conserva el último estado confirmado y muestra el error. Reintentar conserva el tipo de operación. Una carga inicial incompleta muestra el error y exige reintentar la lectura antes de modificar avisos. Cambiar de cuenta vuelve a cargar el estado; cerrar sesión cierra el popup.

## Verificación local

- Nest/PostgreSQL reales sobre una copia desechable local, con cuenta sintética y ASHEN SHELL de prueba a 110 €, todas las tallas agotadas. Se reutiliza la imagen pública del producto, copiada solo para la revisión local. Correo y pagos externos simulados.
- Ratón a 1440 px: botón exactamente 2 px, negro/blanco y vuelta al estado original; tarjeta inmóvil; medidas, borde y fuente iguales. Hover reversible de S, L y XL sin crear solicitudes.
- XS y M inicialmente activas; añadir L sin perder anteriores; cerrar, recargar y abrir conserva XS/M/L. Cancelar solo M conserva XS/L. Cerrar sesión y volver a entrar con la misma cuenta conserva XS/L.
- Fallos reales de INSERT y UPDATE en PostgreSQL: alta fallida sin resaltado, cancelación fallida manteniendo todas las suscripciones activas, errores visibles y posterior operación correcta. Los fallos son controles exclusivos del script local.
- Teclado: Tab entre tallas, foco visible, Escape y retorno al botón de origen. Táctil Chromium emulando iPhone 13 a 390 px: alta por toque, fallo de alta, recarga, cancelación de M, XS/L persistentes y sin hover pegado ni desbordamiento.
- 4 suites / 58 pruebas aprobadas: `restock-dialog.dom`, `quick-add-last-units.dom`, `waitlist.service`, `waitlist.controller`. Incluyen nueve casos del selector, lectura inicial fallida y recuperación sin altas prematuras.
- `npm.cmd run storefront:build`, comprobaciones de sintaxis y `git diff --check` aprobados. `store.min.css` regenerado y enlazado por hash; `store.css` pasa a v131, `waitlist.css` a v3 y `waitlist.js` a v5 en todas sus referencias HTML.

## Revisar y repetir

Revisión abierta en `http://127.0.0.1:43131/`: primera tarjeta **ASHEN SHELL**. Los navegadores de revisión de escritorio y móvil tienen abierta la cuenta sintética, actualmente con **XS y L**. Sus datos de acceso están en `output/playwright/restock-selection/fixture.json` (`users.buyer.email` y `password`), excluido de Git.

```powershell
# Crear una nueva copia aislada, con XS/M como estado inicial.
node cronox-backend/scripts/review-product-editions-integrated.cjs --restock-selection
node cronox-backend/scripts/prepare-restock-selection-browser.cjs

# Playwright CLI: escritorio primero y móvil después, con sesiones independientes.
playwright-cli --session cronox-restock-selection open http://127.0.0.1:43131/ --headed
playwright-cli --session cronox-restock-selection run-code --filename output/playwright/restock-selection/browser.cjs
playwright-cli --session cronox-restock-touch open http://127.0.0.1:43131/ --device "iPhone 13" --headed
playwright-cli --session cronox-restock-touch run-code --filename output/playwright/restock-selection/mobile.cjs

# Pruebas automatizadas desde cronox-backend
npm.cmd test -- --runInBand src/frontend/restock-dialog.dom.spec.ts src/frontend/quick-add-last-units.dom.spec.ts src/waitlist/waitlist.service.spec.ts src/waitlist/waitlist.controller.spec.ts
```

Solo una revisión puede usar el puerto 43131 a la vez. Cerrar mediante `/__review/stop` elimina exclusivamente su base desechable. Una nueva ejecución cambia el nombre de base, IDs y correo sintético. El control local `/__review/restock` acepta `op: reset-selection` para restablecer XS/M antes de repetir el recorrido; no forma parte de la aplicación publicada.

Capturas locales en `output/playwright/restock-selection/`: `cta-hover-1440.png`, `initial-xs-m-1440.png`, `cancel-error-1440.png`, `final-xs-l-1440.png`, `final-xs-l-390-touch.png`. Extractos, credenciales y archivos de prueba permanecen fuera de Git.
