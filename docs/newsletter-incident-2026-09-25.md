# Incidencia de newsletter — 25/09/2026

## Causa reproducida

Producción y repositorio partían de `50d5129f4f4a5056c628c098709aceac7764e818`; árbol local limpio. El popup de `app.js?v=74` llama a `apiEndpoint` y `getCsrfHeaders` desde la segunda IIFE, pero las funciones sólo existen en la primera. El navegador real produce `ReferenceError: apiEndpoint is not defined`, muestra «Ha habido un problema, inténtalo de nuevo» y no emite POST. También falla la carga de configuración visual.

Se reprodujo primero con una dirección reservada y bloqueo de red y después con el buzón autorizado por el propietario. En ambos casos hubo **0 peticiones de suscripción**; no existe un estado HTTP de suscripción que reportar. No se guardaron esas solicitudes. No se incluyen direcciones, cookies ni tokens en este informe.

## Inspección de producción, antes del cambio

- SSH `deploy`; backend Node root y checkout en `/var/www/cronox/Web_Cronox`.
- `.env` del servidor: correo habilitado, configuración INFO presente, SMTP TLS configurado, URLs públicas en `https://www.cronox.es`.
- Autenticación SMTP INFO verificada sin enviar correo. No hay plantilla publicada personalizada para confirmación; la plantilla de respaldo incluye la acción.
- Destino de ese entorno: Supabase `frqlgocxnyppzdgxxjuq`, base `postgres`, Session pooler EU West.
- Consulta de sólo lectura: 0 suscripciones; 0 verificadas; 0 pendientes con/sin token.
- El entorno `/proc` y logs PM2 del proceso root no son legibles por `deploy`: no se confunde el archivo `.env` con una lectura de los valores efectivos del proceso.
- 56 migraciones aplicadas, ninguna pendiente. Este arreglo no cambia el esquema ni requiere reparación de datos; no se ejecuta una migración ni se necesita una copia previa a una migración.

## Corrección

- Helpers de API y CSRF en el ámbito de la newsletter; fallo explícito si no está disponible CSRF.
- Una solicitud en vuelo; validación de formato; feedback español persistente y reintentable. Éxito sólo con 202 y contrato `accepted`, no con cualquier 2xx.
- Guardar el intento antes del envío. Correo desactivado o fallo SMTP devuelve 503, no éxito silencioso. Se conserva el token por si SMTP aceptó el mensaje antes de un timeout. No se promete entrega en el buzón ni se considera 202 una confirmación.
- Mismo recorrido y respuesta para direcciones nuevas, pendientes y verificadas; una fila única por email. Reintentar rota el token y el mensaje indica usar el último correo. No se borra `verifiedAt` al repetir. Actualización condicional frente a carreras, reintento acotado de colisión de unicidad.
- Sólo confirmar un hash válido y vigente permite reclamar beneficios. Consumo atómico del token. Un enlace inválido/caducado/usado ya no produce una página de éxito.
- Correo en español; respaldo si una plantilla publicada elimina el enlace de confirmación.
- Checkout conserva consentimiento opcional y no trata 409 ni un cuerpo inesperado como éxito. No se cambia ningún pago.
- Versiones de assets: `app.js?v=75`, `checkout.js?v=21`. Los cambios HTML son sólo estas referencias.

## Verificación y publicación

- 61 pruebas focalizadas de newsletter/correo/CSRF/DOM, 55 de checkout/configuración, 59 del control de publicación de exportaciones; todas correctas.
- 4 pruebas de navegador: Chromium y WebKit, 1366 y 390 px, fallo SMTP simulado y reintento sin falso éxito, CSRF y sin desbordamiento horizontal.
- Compilación Nest, sintaxis JS y smoke de artefactos/servidor compilado correctos.
- Publicación mediante commit aislado y el workflow existente de `main`. No lanzar campañas ni reenviar masivamente intentos históricos.
- La recepción en el buzón y la confirmación de producción deben verificarse después del despliegue; este documento por sí solo no declara resuelta la incidencia.
