# CRONOX: restauración del menú vertical

Se comparó `707fe87` con su padre `096dc11`. La solución anterior añadía `position:fixed`, ancho, borde y sombra a los paneles de escritorio y calculaba su posición desde JavaScript. Se han retirado esas reglas y cálculos. Se recuperan los submenús dentro de la columna, debajo de su cabecera, con los espaciados, tipografía, colores, resaltado y scroll originales. La regla explícita de `hidden` se conserva para garantizar un único panel principal visible.

Las correcciones de Correo de `707fe87` permanecen intactas: `admin-inbox.js` y `admin-inbox.css` no cambian. Tampoco se revierten borradores, almacenamiento de enviados, historial ni seguimiento de campañas.

## Causa y estado del menú

Al abrir un grupo dentro del flujo vertical, otros encabezados se desplazan bajo el puntero. Los eventos de entrada/salida sobre esos elementos no siempre representan movimiento del usuario: responder a ellos iniciaba nuevos cambios de altura y una cascada de aperturas y cierres.

El menú usa ahora movimientos reales del puntero, comprobando que sus coordenadas cambien. No interpreta las entradas/salidas provocadas únicamente por el layout como una intención nueva. Mientras el usuario llega a un grupo que se ha desplazado, conserva su región anterior y el corredor hasta la zona actual; al alcanzar esta, la región anterior se descarta. Esto permite llegar a sus enlaces sin cerrar el panel durante el desplazamiento. Salir de esa zona con movimiento real vuelve al fijado o cierra todos si no existe uno.

El estado visible sigue siendo el temporal o el fijado. Los demás paneles se cierran antes de abrirlo. Clic fija el temporal; repetir clic en el fijado lo cierra y bloquea la reapertura mientras el puntero permanezca en su cabecera. El foco permite recorrer el panel visible sin imponer un grupo diferente al hover. No se persiste el temporal y no se añaden temporizadores, portales, paneles flotantes ni nuevas reglas de posicionamiento.

Multimedia → Galería → Mosaico/Carrusel sigue dentro de la columna. Enter/Espacio, Escape, navegación, permisos y ARIA se conservan. La selección de ruta limpia el estado transitorio anterior.

## Verificación local

- `sidebar-inline.browser.js`, con movimientos de ratón reales de Playwright: recorridos lentos (24 pasos) y rápidos (1 paso), tanto desde fuera como directamente entre cabeceras dentro de la columna. Tras cada recorrido se deja inmóvil el puntero y se comprueba que no haya nuevas mutaciones de apertura. Se prueban fijación, restauración, desfijación, temporal sin fijado y llegada continua a los enlaces del submenú desplazado.
- Se miden los límites y el posicionamiento estático de cada panel; abrir Producto desplaza los encabezados siguientes más de 100px. Nunca queda visible más de un panel principal. Galería puede abrirse junto a su padre.
- Escritorio 1440px y móvil táctil 390px, claro/oscuro; navegación por Mosaico y Carrusel, Enter/Espacio/Escape, correspondencia de ARIA, ausencia de desbordamiento horizontal y scroll del menú en un viewport de 480px de alto. Se revisaron las cuatro capturas `output/playwright/sidebar-inline-*.png`.
- Regresión de Correo en navegador con el test de estabilidad anterior, adaptando únicamente su expectativa del menú a paneles verticales. Conserva la verificación de cinco ciclos sin novedades, llegada única y filtrada, foco, scroll, lector, edición y peticiones antiguas.
- 47 pruebas DOM del administrador, autenticación, galería y estabilidad de Correo; 62 comprobaciones de integración del harness local con PostgreSQL efímero, SMTP/TLS loopback e IMAP simulado. Compilación del administrador, sintaxis y `git diff --check`.

Para repetir, arrancar `node cronox-backend/scripts/review-mailbox.cjs --serve` con el backend compilado y ejecutar secuencialmente:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=cronox-inline open http://127.0.0.1:43121/__mailreview/superadmin
npx --yes --package @playwright/cli playwright-cli -s=cronox-inline run-code --filename tests/admin-review/sidebar-inline.browser.js
npx --yes --package @playwright/cli playwright-cli -s=cronox-inline run-code --filename tests/admin-review/mailbox-stability.browser.js
npx --yes --package @playwright/cli playwright-cli -s=cronox-inline close
```

El test del menú bloquea conexiones externas y todas las peticiones de escritura. Al finalizar, escribir `stop` en la terminal del harness. No hubo correos reales, cambios del proveedor o de producción, push ni despliegue.
