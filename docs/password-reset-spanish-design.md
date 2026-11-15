# Restablecimiento de contraseña en español

El diseño aprobado se recuperó de la rama local de respaldo `backup/local-mail-designs-20261115`, conservando su composición y reutilizando el bloque del logo oficial ya publicado. `password-reset-design.ts` centraliza asunto, texto previo, título, cuerpo, botón, caducidad y aviso final, junto con el documento visual editable y el texto plano.

El respaldo de EmailService se selecciona exclusivamente por la finalidad PASSWORD_RESET. PASSWORD_SETUP_NEW_ACCOUNT y PASSWORD_SETUP_EXISTING_ACCOUNT comparten el tipo de transporte, pero conservan sus diseños, textos y lógica. No se cambia generación, consumo ni caducidad del token. El único valor variable del nuevo diseño es `{{actionUrl}}`.

## Tarjetas existentes

`password-reset-rollout.ts` prepara las cinco tarjetas existentes de No-reply en los círculos 1–5 a partir de un inventario de producción. No crea tarjetas ni importa datos locales. Actualiza el diseño del borrador y conserva identidad, carpeta, clasificación, firma y estado.

Si existe una publicación, genera su nueva versión desde el snapshot publicado anterior, conservando sus metadatos; nunca publica el borrador como efecto secundario. Mantiene la misma clave de círculo y todas las versiones históricas. Si no existe publicación, la tarjeta continúa en borrador y el envío usa el respaldo español.

La aplicación del plan exige una transacción serializable, bloqueo de las tarjetas/publicaciones y coincidencia de la huella del inventario revisado. Cada actualización deja auditoría EMAIL_PASSWORD_RESET_DESIGN_UPDATE. La verificación posterior usa el servicio de envío real con transporte en memoria, enlaces ficticios con parámetros/fragmento y los cinco círculos; contrasta HTML, texto plano, estados, IDs, historial y ausencia de cambios en las otras finalidades. No se crean pedidos, tokens ni correos reales para verificar.
