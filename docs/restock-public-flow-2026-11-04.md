# Productos agotados y avisos de reposición — 4 de noviembre de 2026

## Implementación

Las tarjetas compartidas utilizan una capa blanca al 68 % exclusivamente sobre el área fotográfica, con «Agotado» y «Avisarme» centrados en negro. Se retiran el aviso rojo y el tachado por agotamiento; no se eliminan estilos o elementos de descuentos reales. Las proporciones, encuadres y el pie del producto se conservan. La disponibilidad proviene de las variantes públicas del lote activo; una talla comprable evita la capa y mantiene «Últimas unidades» cuando corresponde.

La tarjeta pasa a ser un `article`, con enlaces independientes para fotografía y nombre. Los botones de aviso, favoritos y galería son hermanos de los enlaces, sin controles anidados. La atenuación no intercepta eventos. Las tarjetas de tienda, filtros de categoría/colección, favoritos, perfil y recomendaciones siguen utilizando `CRONOX_createProductCard` y el decorador compartido. El selector también se utiliza desde quick add y la ficha.

El nuevo diálogo muestra las tallas activas con los códigos, etiquetas y orden del sistema existente. Una selección expresa guarda inmediatamente; no hay confirmación adicional. Durante la petición se bloquean los envíos, se muestra el progreso y solo se confirma después de la respuesta del servidor. El error conserva talla y ofrece reintentar; un aviso existente se identifica sin duplicarlo. Se mantiene la posibilidad de cancelarlo. El foco se contiene en el diálogo y vuelve al origen al cerrarlo, incluido el recorrido que pasa por autenticación.

La ficha agotada mantiene galería, detalles, precio y tallas seleccionables, oculta la compra y ofrece Avisarme. No selecciona una talla agotada por defecto: el usuario la elige, o se reutiliza una selección expresa o enlazada. Los productos parcialmente disponibles conservan su compra; desde una talla agotada usan el mismo aviso. Se consulta la disponibilidad vigente antes de inscribir y el servidor vuelve a validarla bajo bloqueo. Si hay reposición durante el selector, se ofrece un enlace de compra con la talla y no se crea otra solicitud.

## Identificación, identidad y envío

La waitlist existente requiere cuenta activa y correo válido; no existe suscripción como invitado. El visitante conserva su intención de producto y talla durante 30 minutos en su sesión del navegador y utiliza el acceso/registro habitual. Después de identificarse se revalida y completa esa intención. Una persona autenticada no vuelve a introducir correo. Visitar o abrir el selector no crea solicitudes.

No se migran ni se recrean solicitudes. La implementación actual conserva variantes mediante `upsert` por `(productId, size)` y no las elimina al cambiar de tirada. Ese identificador estable conserva el interés por producto y talla; las variantes incompatibles pasan a inactivas, sin reasignar solicitudes a otra talla. Se mantienen el bloqueo de inscripción y el índice único parcial de solicitudes activas. El servidor comprueba disponibilidad incluso cuando encuentra una inscripción anterior.

Se reutilizan los triggers PostgreSQL y el worker de waitlist, no se añade una segunda vía de envío. Los triggers observan el stock público proyectado y la visibilidad; esperan cinco minutos de disponibilidad continua. El worker vuelve a comprobar destinatario, stock, variante activa, producto visible y apertura de tienda; utiliza nombre, imagen y URL públicos vigentes. Se mantienen la política de reintento seguro, el cierre `ACCEPTED` y la protección ante resultados inciertos.

Se corrigió un efecto de la proyección de tiradas: desactivaba y reactivaba todas las variantes al guardar, aunque no cambiaran. Ahora solo desactiva las que dejan de estar activas. Guardar sin cambios conserva el plazo de reposición en vez de reiniciarlo.

El administrador mantiene su informe de demanda y añade **Ver destinatarios y estados** por talla, con paginación. El nuevo endpoint `/api/admin/waitlist/:variantId/requests` conserva los guardas de administrador; no expone destinatarios a usuarios ordinarios o visitantes.

## Verificación integrada

Chromium con tienda y administrador reales, Nest, autenticación, CSRF, controladores y PostgreSQL local aislado. Se clonó la base local para cada revisión; no se escribió en la base original. Pago, correo y almacenamiento externo se simularon y la red externa del servidor se bloqueó. La subida de imágenes pasó por el procesador real y escribió archivos locales.

Comprobado desde navegador:

- Productos disponibles, parcialmente agotados y totalmente agotados; enlaces de fotografía, selector de tarjeta, favoritos y quick add. Compra de un producto disponible hasta añadirlo al carrito real, sin checkout ni pago.
- Visitante → talla → acceso habitual → inscripción automática, selección de otra talla, doble clic, dos primeras peticiones simultáneas y reintentos concurrentes. Una sola solicitud activa por persona y talla.
- Cierre, recarga y consulta posterior de inscripciones reales; ficha parcialmente disponible y ficha totalmente agotada, sin talla agotada elegida automáticamente. Una selección expresa se reutiliza.
- Fallo de inserción provocado en PostgreSQL: sin solicitud guardada, selección conservada y reintento satisfactorio. Cancelación y nueva inscripción preservan los registros cancelados.
- Reposición con el selector abierto: compra ofrecida para la talla correcta, sin nueva solicitud.
- Recepción de L desde el editor real del lote activo: solo L pasa a cola. Guardar otra vez conserva exactamente `readyAt`.
- Worker real con transporte simulado: respeta los cinco minutos; un fallo seguro deja L en cola con reintento pendiente y ningún envío aceptado; respeta el backoff y después acepta un único aviso L.
- Preparación de un segundo lote desde el administrador, con M y nueva ficha/imagen: mientras está inactivo no altera la tienda ni dispara avisos. Al activarlo en la misma URL, M pasa a cola y se acepta un único aviso con el destinatario, nombre, enlace e imagen vigentes. El enlace y la imagen responden 200.
- Repetir guardado y procesamiento no repite los dos avisos aceptados. Activar después una tirada con tallas US no transforma la solicitud XS anterior: queda pendiente y su variante inactiva no genera correo.
- Solicitudes y destinatarios visibles en el administrador; acceso al endpoint de destinatarios denegado con HTTP 403 a un usuario normal.
- Fotografías y selector a 320, 390, 430 y 1366 px, sin desbordamiento; teclado, ciclo de Tab/Shift+Tab, Escape y devolución del foco. Se detectaron y corrigieron el retorno tras acceso y la salida de foco por el extremo del diálogo.

Resultado de correo: **dos mensajes aceptados por el servicio simulado**, L por recepción y M por activación. Esto verifica la ejecución y los datos del aviso, no una entrega SMTP real ni llegada a una bandeja de entrada.

Regresiones: 14 suites y 155 pruebas distintas aprobadas; pruebas focalizadas repetidas tras los ajustes de teclado y selección, incluida la renovación de la lista cuando cambia a un sistema de tallas incompatible. Regresión PostgreSQL de tiradas aprobada, incluyendo plazo de reposición, costes históricos, reservas, stock y activación. Typecheck de backend y administrador, compilación Nest, compilación Vite, minificados y revisión de sintaxis aprobados. Versiones de caché actualizadas en los HTML consumidores. Evidencia local en `output/playwright/restock-flow/` y registros `output/restock-*.log`.

## Repetición y pendientes

Arranque: `node cronox-backend/scripts/review-product-editions-integrated.cjs --restock`. Preparar cada paso con `node cronox-backend/scripts/prepare-product-editions-browser.cjs <paso> --restock` y ejecutar el archivo generado mediante Playwright CLI, en este orden: `restock-browser`, `restock-delivery`, `restock-availability`, `restock-final-check`. El primer paso borra únicamente las cookies de la sesión de prueba. Los controles `__review` existen solo en este servidor de pruebas; no se montan en la aplicación desplegada. `/__review/stop` guarda el estado final y elimina su base aislada.

No se necesitan migraciones nuevas. La configuración externa de producción no se ha modificado ni validado: requiere correo habilitado (`EMAIL_ENABLED`), transporte SMTP válido (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_NOREPLY_USER`, `SMTP_NOREPLY_PASS`), `FRONTEND_URL` correcto, procesos de fondo activos y el worker de waitlist habilitado. El informe del administrador muestra el estado efectivo de remitente, worker y apertura. La entrega real debe verificarse en el entorno autorizado tras publicar; los resultados inciertos no se reenvían automáticamente.

Trabajo exclusivamente local. Se conserva el trabajo previo. Sin commit, push ni despliegue.
