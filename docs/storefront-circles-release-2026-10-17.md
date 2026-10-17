# Interfaz y círculos · 17/10/2026

## Publicación

Versión de aplicación: `5e5e1e7fd761e71ddef84e1aaeef70f454d849b6`.

- [CI del push](https://github.com/danir23007/Web_Cronox/actions/runs/39008550215): correcta.
- [Verificación y despliegue](https://github.com/danir23007/Web_Cronox/actions/runs/39008871699): correctos.

## Interfaz

RECOMENDADOS reserva espacio en el flujo normal de la ficha de escritorio. En 2560×1440, el título termina en y=1428 y los productos comienzan en y=1447,90625. En 2560×1280, termina en y=1268 y los productos comienzan en y=1287,90625. Se conserva la separación título-productos de 19,90625 px, las fotografías, miniaturas, tarjetas, tipografía y disposición móvil. Se comprobaron siete ventanas.

Los filtros de categorías, drops y Todos desde la home entran en `/tienda`, sin portada; la home ordinaria conserva la imagen. Las recomendaciones conservan su catálogo independiente. El punto naranja se limita a los avisos de la cesta y usa disponibilidad real de la variante para las líneas añadidas.

Cada apertura del quick add consulta disponibilidad actual. El botón permanece deshabilitado hasta recibirla y conserva las validaciones de talla, cantidad y doble clic. Un añadido confirmado cierra el panel. Si falla la presentación posterior, se recupera mediante GET, sin repetir el POST confirmado. El error original del usuario no volvió a reproducirse en localhost:3000 y el usuario confirmó que había dejado de fallar. El bloqueo CORS reproducido en un puerto distinto fue una comprobación complementaria, no una causa demostrada de su incidencia.

El selector de PayPal incorpora el recurso oficial sin modificar y mantiene radio nativo, exclusividad, teclado y foco. No cambia la lógica de pago, los botones exprés ni la configuración de Stripe. La acreditación espera los datos iniciales que afectan al tamaño y resuelve el ajuste antes de mostrarse; conserva diseños, selección activa, identidad, QR, dimensiones finales y movimiento.

Las referencias de caché de los recursos modificados se actualizan en todas las páginas que los comparten.

## Círculos y migración

La política compartida asciende I→II con gasto neto computable **mayor o igual a 8.500 céntimos**. Reutiliza las métricas financieras de compras online y presenciales, incluyendo reembolsos y las reglas de los archivos contables. Los cambios financieros encolan reconciliación persistente tras confirmarse; el procesamiento no depende de abrir la cuenta o presentar un QR.

La única migración nueva es `20261017120000_circle_spend_promotion`. Añade `User.circle2PromotedAt`, la cola privada con RLS, tres funciones y cuatro triggers. Es aditiva y no modifica migraciones anteriores ni promueve automáticamente a todos los usuarios históricos. Se verificaron 95 migraciones aplicadas, una más que antes. SHA-256 canónico: `d36be74662c9dcdf1f5ef69c3fb27e71f260f5636cb353a54221396cf020a79f`.

La fecha de ascenso se conserva. La solicitud II→III exige 30 días completos, exactamente 2.592.000 segundos, también en el servidor. Libro y METACRILATOS comparten botón, bloqueo y cuenta atrás anclada al tiempo del servidor. La expiración comprueba de nuevo la elegibilidad y habilita la solicitud; no concede el círculo III. Las transacciones protegen solicitudes concurrentes y conservan el procesamiento posterior ya existente.

La reparación histórica está limitada a los nueve User.id autorizados. Sus identificadores, importes, fechas y trazabilidad se conservan en los informes privados y AuditLog, fuera del repositorio.

## Verificaciones previas

- Suite completa: **250 suites, 2.635 pruebas**; tipos frontend/backend y ambas compilaciones correctos.
- PostgreSQL desechable: **9 bloques** para umbral inclusivo, mezcla de compras, reembolsos, persistencia, idempotencia, plazo exacto y solicitudes concurrentes. Se elimina sólo la base desechable creada por el propio harness.
- Controles de despliegue: 13 pruebas; exportaciones: 59 pruebas y comprobaciones de artefactos/rutas compiladas.
- Cesta real en localhost:3000, invitado y cuenta local autenticada; también invitado en 127.0.0.1:3000. Disponibilidad GET 200, una sola adición POST 201, talla/cantidad, contador, importes, cierre y recarga correctos. Se restaura la cesta previa de la cuenta local.
- Recuperación complementaria: fallos de disponibilidad, POST e interfaz provocados deliberadamente; los éxitos provienen del backend real. Tras POST exitoso, reintentar la carga sólo emite GET y no duplica artículos.
- Navegador Chromium: 41 pruebas de cesta correctas. Filtros y ficha locales usan API real, sin intercepciones.
- Acreditación: 30 navegaciones comparativas con datos de cuenta/QR simulados y renderer real; variación visible inicial 0 px. Las comprobaciones adicionales de los círculos III/V conservaron la geometría. Plazo, expiración, solicitudes y bloqueo se prueban con datos controlados.
- PayPal: selección, flechas, foco y recurso oficial en 1440, 390 y 320 px, con proveedor simulado. No se efectúan pagos.

La comprobación previa de WebKit conserva una incidencia ajena a este cambio: un pageerror de acceso durante navegación rápida, reproducido también con los assets anteriores. Las aserciones funcionales pasaron; no se modificó producción para ocultarlo. No se realizaron pruebas con dispositivos físicos.

## Respaldo y recuperación

Se tomó un pg_dump con snapshot consistente y respaldo privado de frontend, backend compilado, manifiestos, locks, esquema, historial y configuración. Directorio 700 y archivos 600. Se restauraron exactamente **110 tablas** de `public` y `cronox_private`, propietarios, ACL, RLS, funciones y políticas, en PostgreSQL aislado por socket Unix, sin aplicación ni workers.

En esa copia se aplicó exclusivamente la migración nueva: 51 usuarios y sus campos previos intactos, nueva fecha NULL, cola vacía, selección y diseños conservados. La reparación aislada creó nueve ascensos y nueve auditorías; repetirla no modificó nada. También se verificaron conservación de II/V, ejecución parcial y aborto ante evidencia financiera modificada. El cluster aislado quedó detenido.

La recuperación prioriza una corrección compatible hacia delante. La migración aditiva se conserva y no se edita su historial. Tras reparar clientes no se vuelve al backend anterior que calculaba otro umbral. El respaldo completo no se restaura sobre producción activa: primero se recuperaría en otra base y se conciliarían pedidos y cambios posteriores. Configuración y frontend sólo se recuperarían si existiese un defecto comprobado, preservando cambios legítimos posteriores. El procedimiento detallado y los manifiestos permanecen privados junto al respaldo.

## Verificación posterior

El 17/10/2026 a las 06:16:09 UTC se verificó el SHA exacto del VPS, un único proceso backend nuevo y la desaparición del PID anterior. El código compilado carga el reconciliador y las constantes 8.500 céntimos/2.592.000.000 ms; rechaza el instante anterior a los 30 días y acepta el límite exacto. Salud y disponibilidad responden 200.

Los 49 archivos de frontend comprobados en disco coinciden exactamente con sus blobs Git. Por HTTP coinciden los 21 recursos estáticos; las 28 páginas conservan sus referencias y estructura o aplican su redirección prevista de acceso. El middleware SEO transforma el HTML público, por lo que su cuerpo completo no se compara como un asset estático. Se conserva la protección de cuatro endpoints privados y la selección METACRILATOS.

La nueva auditoría anterior a la reparación no detectó diferencias en estado ni gasto de los nueve clientes. La reparación realizó nueve ascensos y nueve entradas de AuditLog a las **06:17:15.185 UTC** del 17/10/2026, equivalentes a **08:17:15.185 Europe/Madrid**. Repetirla produjo cero cambios y mantuvo todas las fechas y auditorías. El vencimiento es el 16/11/2026 a las **06:17:15.185 UTC / 07:17:15.185 Europe/Madrid**: la diferencia de hora local respeta el cambio de horario y los 30 días completos.

El código compilado real confirmó para los nueve el círculo II, gasto neto intacto y solicitud III bloqueada por plazo, sin solicitudes pendientes. Prisma y SQL coinciden en sus fechas UTC y la cola está vacía. Se conservan los otros 42 usuarios y los campos ajenos al ascenso de los nueve, así como finanzas, solicitudes, diseños y selección. La distribución final es 41 usuarios I, nueve II y uno V.

La conservación de usuarios se contrasta con el snapshot inmediatamente anterior a la reparación. Frente al respaldo más antiguo, una cuenta ajena ya tenía actualizados sus campos de consentimiento analítico; esa actividad anterior se conserva y no se atribuye a la reparación. La comparación ampliada mantiene configuración, finanzas, solicitudes e identidades.

La comprobación visual pública real confirmó RECOMENDADOS en 2560×1280 con los valores indicados arriba, y filtros de Camisetas, D#01 y Todos en escritorio/móvil. En ventanas más bajas, el contenido real del panel de compra puede exigir desplazamiento natural; no se recorta ni se solapa. Sin errores de página ni fallos de catálogo. Las respuestas 401 de cuenta/favoritos son las esperadas para una visita anónima.

La cesta de producción se probó con una sesión invitada nueva y sin interceptar respuestas: ASHEN SHELL, talla M, una unidad. GET de disponibilidad 200; doble clic con exactamente un POST 201; cierre, contador 1 e importe 90 € correctos. Navegar y recargar `/cesta` conserva variante, talla, cantidad, importes y aviso naranja junto a la talla. El aviso de recomendación aparece sólo en el producto escaso. Al terminar se vació exclusivamente esa cesta y se confirmó GET vacío, cerrando el navegador.

La inspección autenticada de las acreditaciones y PayPal se realizó con datos controlados en local. En producción se comprobaron los datos reales con los servicios compilados, recursos publicados, protección de rutas y configuración; no se crearon sesiones artificiales de clientes ni pedidos o cobros de prueba.

Los informes privados permanecen bajo `output/circle-release/` y `output/playwright/`. El respaldo y la recuperación ensayada permanecen en el VPS. Este informe se incorpora mediante un commit documental posterior; no cambia el commit de aplicación ejecutado.
