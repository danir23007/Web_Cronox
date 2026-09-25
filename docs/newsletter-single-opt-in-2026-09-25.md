# Newsletter: alta directa y registro de envíos

## Reglas

- El envío explícito del formulario guarda consentimiento (`subscribedAt`) y envía una bienvenida. No verifica la identidad de una cuenta (`verifiedAt` permanece independiente).
- No se genera enlace de confirmación; los enlaces antiguos redirigen al inicio sin mutar datos.
- Cada dirección conserva un único beneficio de bienvenida. Los códigos nuevos tienen seis caracteres aleatorios; los ya emitidos no cambian.
- El cupón es personal, de primera compra y de un solo uso. Se valida también para invitados con el mismo correo. Pedidos PENDING/CANCELLED no cuentan como compras previas.
- Repetir el formulario no genera otro cupón ni reenvía una bienvenida aceptada. Un fallo conocido permite reintentar con el mismo cupón. Un resultado SMTP incierto conserva el bloqueo para revisión, evitando duplicados automáticos.
- Correos registra intentos, fallos y aceptación SMTP desde esta versión. No inventa entregas históricas ni afirma recepción en bandeja. No guarda cuerpos, tokens ni códigos en el registro.
- No se activa ninguna campaña. Los suscriptores antiguos pendientes no se dan de alta mediante la migración.

## Migración y respaldo

Migración Prisma: `20260925131152_newsletter_single_opt_in`, transaccional. Añade consentimiento, asociación de cupón y estado de bienvenida; crea EmailDelivery con RLS sin acceso público; hace utilizables los cinco códigos históricos en PromoCode sin cambiar sus cadenas ni estado de uso.

Objetivo verificado: Supabase `frqlgocxnyppzdgxxjuq`, base `postgres`, pooler de sesión eu-west-1:5432.

Copia previa: `C:\Users\danir\OneDrive\Documentos\CRONOX-database-backups\cronox-production-newsletter-20260925-132653.dump`.
801814 bytes; 1046 entradas; pg_dump, pg_restore --list y lectura completa pg_restore --file NUL correctos.
SHA-256: `689394e0226722b17d0720634ad9132cc9fa5c1358433986513a364ac025e091`.

## Verificación previa a publicación

- 183 pruebas focalizadas en 14 suites; 59 pruebas de contratos de exportación; compilación y smoke compilado correctos.
- Cuatro pruebas de navegador Chromium/WebKit, escritorio/móvil, incluyendo fallo y reintento.
- Migración exacta probada en PostgreSQL 17 local con datos sintéticos: diferencia de esquema vacía tras aplicarla.
- Integración con Prisma real y SMTP simulado: concurrencia, reutilización, registro de fallos, invitado/correo incorrecto, primera compra y consumo único. Script `scripts/verify-newsletter-local.cjs` limitado a localhost; requiere esquema migrado y fixture legado (dos códigos de bienvenida, uno usado).
- Sin pedidos, campañas ni ajustes de inventario en producción para probar.

La comprobación de recepción real del nuevo flujo requiere confirmación del buzón controlado; aceptación SMTP no la sustituye.
