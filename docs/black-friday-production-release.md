# Black Friday · publicación autorizada

El usuario autorizó expresamente commit, push y despliegue mediante el procedimiento habitual de CRONOX. Esta publicación incluye únicamente la capa visual Black Friday, su configuración, vistas previas, pruebas y migraciones. No activa la campaña, modifica precios o checkout, ni realiza compras o envíos de prueba.

## Revisión previa de producción

- `main`, `origin/main` y el VPS coincidían en `4e93021213faf40570e105eb96d5549aba68f25b`.
- Consulta de base de datos en transacción **READ ONLY**: 125 migraciones terminadas, ninguna fallida; historial compatible con los SQL versionados, contemplando sus finales de línea históricos LF/CRLF. No se modificaron migraciones antiguas.
- `20261124120000_cart_abandonment` ya está aplicada en producción. No forma parte del diff ni se vuelve a aplicar. No se publican cambios de carrito abandonado con esta funcionalidad.
- `BlackFridaySettings` todavía no existía. La configuración prevista tras desplegar es **desactivada**, independiente del interruptor local, que se conserva en la instalación de desarrollo.
- Portada y `/api/health`, `/api/ready` respondían 200; `/api/black-friday` devolvía el 404 esperado antes de publicar la nueva ruta.
- Pages está en modo workflow. Un push ejecuta comprobaciones; la publicación del VPS requiere `workflow_dispatch` con `publish=true` en **Deploy CRONOX**. Se conserva el controlador instalado, sus respaldos y comprobaciones de mantenimiento.

## Migraciones de esta publicación

1. `20261125120000_black_friday_visual`: tabla independiente, fechas absolutas y restricción de finalización posterior al inicio; interruptor inicialmente falso.
2. `20261125130000_black_friday_spanish_defaults`: texto español y objetivo del contador el 26/11/2026 a las 21:00 Europe/Madrid (`2026-11-26T20:00:00Z`); fin 28/11/2026 a las 00:00 Madrid (`2026-11-27T23:00:00Z`). Solo cambia valores predeterminados.
3. `20261125140000_black_friday_initialize_private_settings`: habilita RLS sin políticas públicas, revoca privilegios de PUBLIC y crea `global` desactivada mediante `ON CONFLICT DO NOTHING`. Si existe una configuración, no cambia ninguno de sus campos ni su estado de activación. La edición sigue requiriendo el backend autenticado y los permisos de Pantalla Clave.

La inicialización se probó con una tabla temporal que sombrea la tabla local solo en su conexión: registro ausente → desactivado con los valores aprobados; registro existente personalizado → idéntico tras repetir la migración. La transacción termina en rollback. Producción aplica las migraciones únicamente mediante el controlador habitual y `prisma migrate deploy`; no se usa reset, resolve, db push ni seed.

## Comportamiento publicado

- Antes del inicio: bloque grande sobre la portada, con transformación reversible al banner al hacer scroll y umbral con histéresis.
- Marquesina de derecha a izquierda sobre todo el espacio disponible a la izquierda del contador fijo. Dos grupos iguales cubren la franja, con repeticiones decorativas fuera de la lectura accesible y soporte de movimiento reducido.
- Texto editable: **BLACK FRIDAY SOLO EN BLACK FRIDAY · 27/11 — DESDE EL 26/11 A LAS 21:00**.
- Al comenzar: se eliminan título, bloque grande y contraste; se recupera la portada normal. Solo permanece el banner, también arriba y tras recargar o volver de otra pestaña, con **TERMINA EN** hasta el fin.
- Al finalizar o desactivar: presentación habitual; configuración conservada. La hora parte del servidor y el contador recalcula diferencias absolutas.
- Administrador → **Multimedia → Pantalla Clave → Campaña Black Friday**. Guardar el código o desplegar no activa el interruptor. Las vistas previas usan la página y componentes reales sin guardar ni habilitar nada.

## Comprobaciones y alcance de archivos

Se revisó el diff del esquema, módulo Nest, API protegida/pública, componentes de campaña, cabecera y desplazamientos dependientes, HTML de páginas compartidas, administrador, vista previa y pruebas. El CSS minificado de portada se regenera desde la fuente. No se cambian lógica de carrito/checkout, correos ni catálogo: sus páginas solo cargan los recursos visuales y calculan la altura de la cabecera compartida.

Se ajustan las expectativas de pruebas que fijaban versiones anteriores de CSS o la altura de cabecera sin banner. La hoja de campaña se carga en el head, conservando la estructura final del checkout. Herramientas y capturas operativas de publicación, logs, estado local de sesión y credenciales quedan fuera del commit.

La validación incluye tipos de frontend/backend, compilación de ambos, suite completa Jest, seguridad de artefactos, referencias gráficas aprobadas y pruebas de exportaciones. Las comprobaciones del controlador que requieren Linux se ejecutan en GitHub Actions, sin alterar sus tests para adaptarlos a Windows. La verificación posterior exige el mismo SHA en Actions/VPS, salud, recursos públicos y configuración efectiva desactivada.

Los pasos de revisión visual y pruebas de escritorio/móvil se conservan en [la documentación local](black-friday-visual-local.md). El resultado y el SHA exacto se contrastan con el run de GitHub Actions y el diario del controlador de ese mismo SHA; no se inicia otro despliegue si la respuesta de una solicitud resulta ambigua.
