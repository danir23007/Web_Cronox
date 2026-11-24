# Cesta abandonada: contenido y publicación

La copia aprobada reside en `cart-abandoned-design.ts`. Los borradores nuevos, el editor, el envío y el actualizador de contenido usan ese documento. El listado utiliza el fondo oscuro, líneas finas, fotos contenidas en 70 px y los atributos proporcionales derivados de ProductImage.width/height. Si falta metadata, no se fuerza la imagen a un cuadrado. El icono de cesta es PNG; el mensaje termina tras la nota, sin firma ni baja adicional, y el transporte añade el footer compartido con sus preferencias.

No se cambian activación, fecha de inicio, 23 horas, elegibilidad, consentimiento, deduplicación o reintentos. No requiere migración de esquema.

Después del despliegue, ejecutar `node scripts/publish-cart-mail-design.cjs --production` para revisar el plan y añadir `--apply` para la publicación autorizada. El script valida el proyecto, no inicia Nest ni trabajadores, y prohíbe SMTP. Una única transacción actualiza exclusivamente las cinco tarjetas CART_ABANDONED de No-reply mediante ManagedMailService.save/action: revisión CAS, auditoría, versión histórica y publicación independiente por círculo. Conserva IDs, carpetas, clasificación y cabecera/superficie existentes. Compara todas las otras tarjetas, versiones y publicaciones antes y después; cualquier diferencia revierte la operación completa. Repetir con el contenido ya aplicado no crea versiones nuevas.

`test-cart-abandonment-db.cjs` prueba esa actualización con borradores heredados en PostgreSQL local desechable. `preview-cart-mail-design.cjs` genera I-V con tres proporciones de fotografía usando el renderizador real; las capturas de navegador no equivalen a pruebas de recepción en clientes de correo.
