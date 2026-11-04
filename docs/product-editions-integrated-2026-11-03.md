# Verificación integrada de lotes — 3 de noviembre de 2026

## Entorno y alcance

Administrador y tienda reales en navegador, conectados a Nest y una copia PostgreSQL aislada, con autenticación, CSRF, validaciones, controladores, servicios y restricciones de la base reales. No se sustituyeron respuestas de las API de productos, carrito, reservas, pedidos o lotes.

Se simularon únicamente las dependencias externas: Stripe.js y la API externa de Stripe, transporte de correo y almacenamiento de archivos. La subida pasó por el controlador y el procesador de imágenes reales; los archivos se guardaron en el directorio local de revisión. La confirmación y devolución enviaron eventos con firma de prueba al webhook real, que creó/actualizó los pedidos mediante el flujo habitual. La red externa del servidor de revisión estuvo bloqueada.

No hubo cobros, correos, publicación ni cambios en producción. Las escrituras de negocio se limitaron a bases con prefijo `cronox_editions_ui_`. Se conservaron los cambios locales anteriores y los históricos desconocidos. Las bases de revisión se cerraron y eliminaron al terminar, incluida una copia de arranque interrumpida.

## Recorrido comprobado desde la interfaz

1. Recepción de una unidad M en el Lote 1, precio 90 €, producción 25 €, transporte y otros gastos cero. Compra desde la ficha pública y checkout: pedido **12**, coste congelado **2.500 céntimos**, stock agotado.
2. Duplicación con **+**: ficha del lote seleccionado copiada, existencias cero. Lote 2 a 110 €, producción 35 €, transporte 0,04 € para cuatro unidades, composición distinta e imagen PNG subida desde el administrador. Guardar y recargar conservó todo sin publicar el lote 2.
3. Activación desde el botón: misma URL pública a 110 €, nueva imagen cargada efectivamente por el navegador, nuevos detalles y disponibilidad de la segunda tirada. El editor mostró «Lote activado» en la pestaña 2 y «Activar lote 1» en la primera.
4. Segunda compra: pedido **13**, 110 €, coste congelado **3.501 céntimos**, asignado al Lote 2. La venta anterior siguió conservando 90 € y 2.500 céntimos de coste. Su contribución original antes de la devolución era 65 €, frente a 74,99 € en la nueva venta, siguiendo ingresos menos coste en estos casos sin comisión ni gasto adicional.
5. Venta física desde Puntos de venta: tirada 2 seleccionada explícitamente, una unidad descontada una sola vez y coste del lote conservado.
6. Carrito abierto durante el cambio: la cesta mostró el cambio; el checkout lo rechazó hasta revisar. Se siguió el botón **Revisar cesta** y se aceptaron explícitamente tirada y precio actuales desde la interfaz. El precio aceptado persistió.
7. Pago protegido antes de activar otra tirada: se pausó la confirmación en el proveedor simulado, después de la protección real del servidor. Tras cambiar de tirada, la confirmación generó el pedido **14** a 110 € con su asignación original al Lote 2.
8. Mientras el lote activo estaba agotado y el inactivo tenía una unidad, la ficha pública mantuvo agotado y deshabilitó Añadir. No se utilizó el stock inactivo.
9. Devolución de la primera compra mediante evento externo firmado: volvió al Lote 1, que estaba inactivo. Repetir el evento no repuso otra unidad. El stock público del Lote 2 no aumentó.
10. Dos clientes con sesiones y carritos independientes iniciaron checkout simultáneamente sobre la última unidad activa: uno obtuvo reserva; el otro recibió 409. Solo el ganador pudo generar el pedido **15**. Los 201 adicionales observados pertenecen a la renovación/sustitución de su propia reserva durante el formulario, no a otro comprador.
11. Dos solicitudes simultáneas de activación obtuvieron respuestas coherentes y dejaron una sola selección activa, con ficha y stock correspondientes a ella.
12. Permisos reales: anónimo 401, cliente USER 403 y escritura sin CSRF 403. ADMIN pudo consultar y SUPERADMIN activar conforme a `hasAnyRole`, que da acceso administrativo a ambos roles en el repositorio. No se cambió esa política.

Se revisaron administrador y ficha pública a **390 y 1366 px**. El estado final fue cuatro pedidos web (uno devuelto), una venta física, cero unidades disponibles en el lote activo y una en el inactivo. El estado REFUNDED modifica legítimamente el resultado neto de la primera venta; no reemplaza su precio ni su coste originales.

## Fallos reproducidos y corregidos

- **Coste de la primera recepción en un lote inicialmente vacío:** las filas de saldo cero creadas por la migración hacían que el lote permaneciera UNKNOWN, aun documentando todos los costes. Ahora solo las recepciones con cantidad positiva cuentan como histórico previo. Un saldo antiguo con unidades y costes desconocidos conserva su estado pendiente. La valoración de stock tampoco exige costes de filas con disponibilidad cero.
- **Aviso genérico al cambiar la tirada del carrito:** el servidor devolvía PRODUCT_EDITION_CHANGED correctamente, pero el checkout lo presentaba como error genérico. Ahora explica el cambio y ofrece Revisar cesta, tanto al cargar el resumen como al preparar el pago. El aviso de reserva no lo sustituye por una caducidad ni ofrece reintentar la misma cesta sin revisarla.

Se actualizaron la versión del recurso de checkout y las pruebas de regresión de ambos casos.

## Comprobaciones adicionales

- **19 pruebas dirigidas** correctas, en tres suites de checkout y lotes.
- Prueba PostgreSQL de fichas por tirada correcta, ampliada con la primera recepción conocida sobre saldo cero; conserva también los escenarios anteriores de reservas, cambios de precio, devoluciones, conciliación, activación e histórico.
- Comprobación de tipos del backend, compilación, sintaxis JavaScript y `git diff --check` correctas.
- No se repitió toda la suite anterior: esta revisión se centró en la integración real solicitada y las regresiones de los fallos encontrados.

Evidencias locales: `output/playwright/editions-integrated/`, incluyendo capturas de administrador, ficha pública, checkout, carrito y venta física; `final-state.json`, `cleanup.json` y registros de pruebas. Los respaldos de la base y las credenciales sintéticas están ignorados por Git y no deben versionarse.

## Repetir la revisión

Desde cronox-backend, arrancar `npm run review:product-editions:integrated`. Crea una copia local con nombre único y sirve en `http://127.0.0.1:43131`; requiere PostgreSQL 17 local y la configuración local existente. El servidor escribe `fixture.json` con cuentas exclusivamente sintéticas.

Preparar cada celda con `node scripts/prepare-product-editions-browser.cjs PASO` y ejecutarla mediante Playwright CLI `run-code --filename output/playwright/editions-integrated/PASO.cjs` desde la raíz del repositorio. Orden: initial-receipt, first-sale, second-edition, physical-sale, cart-and-reservation, last-unit, activation-and-permissions, final-browser. Las celdas usan el navegador y sesiones independientes, sin simular la API de negocio. Cerrar con GET `/__review/stop`, que conserva la evidencia y elimina la copia.

## Pendiente

No queda un bloqueo reproducido en el recorrido solicitado. Siguen pendientes las conciliaciones históricas sin evidencia, que esta revisión no completa ni inventa. La interacción con Stripe/3DS, wallets y correo de proveedores reales queda fuera de esta revisión por la simulación solicitada. La publicación y su comprobación en producción requieren una tarea posterior.
