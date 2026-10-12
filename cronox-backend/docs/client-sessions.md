# Sesiones persistentes de clientes

USER y FRIEND conservan una sesión por navegador en AuthSession. El access JWT
dura 15 minutos; el refresh es una cookie técnica HttpOnly persistente, SameSite=Lax,
Secure en producción, independiente del consentimiento opcional. No se guardan
credenciales en localStorage ni se recuperan identidades por fingerprinting.

La creación de sesión fija el vencimiento a 500 días. El transporte compartido
del frontend informa una visita después de una respuesta autenticada válida en
una página visible. También comprueba la sesión al volver a una pestaña visible
o recuperar una página desde bfcache. Las señales de interacción y visibilidad
deben proceder del navegador. POST /api/auth/visit mantiene JWT, CSRF y límites
de peticiones; exige metadatos de navegador y descarta agentes de bots conocidos.
Solo USER y FRIEND pueden renovar mediante esta ruta. Las lecturas pasivas,
los refresh, el tráfico anónimo y los procesos internos no amplían su vencimiento.

La visita actualiza atómicamente el registro, el hash y la generación, y devuelve
cookies con el nuevo vencimiento de 500 días. El refresh ordinario rota las
credenciales conservando ese vencimiento. Una renovación que gana frente a una
comprobación de caducidad no puede ser revocada por la lectura anterior.

Los escritores de cookies y el logout se coordinan entre pestañas mediante Web
Locks, con una concesión local de respaldo. La rotación del servidor usa CAS y
una tolerancia de 15 segundos que entrega el mismo sucesor a peticiones
concurrentes. Un predecesor de cliente fuera de esa tolerancia se rechaza con
409 REFRESH_RETRY; no autentica, no revoca la familia nueva y no elimina cookies.
Los errores temporales de red, base de datos, CSRF o límite de peticiones no
confirman un cierre. El logout borra la interfaz y las cookies solo tras confirmar
la revocación. ADMIN y SUPERADMIN mantienen sus políticas específicas previas.

Cierran o invalidan la sesión: logout de ese navegador, 500 días sin visita válida,
bloqueo/eliminación/cambio de estado de la cuenta, cambio de versión de seguridad
(incluidos los cambios de contraseña), y credenciales inválidas. Borrar cookies
o usar otro navegador/dispositivo requiere otra autenticación.

## Límite del navegador

El servidor solicita 500 días, pero Chromium limita cada cookie persistente a
400 días, observado también en la prueba real. Por ello no se puede garantizar
una recuperación mediante cookies tras 400–500 días de ausencia en ese navegador.
Cada visita vuelve a emitir la cookie. No se añade ningún mecanismo alternativo
de identificación para sortear esta restricción.
Referencia: https://developer.chrome.com/blog/cookie-max-age-expires

## Verificación local aislada

1. Compilar frontend y backend; ejecutar TypeScript y Jest.
2. `npm run test:password-flows:serve -- --sessions` desde cronox-backend crea una
   base UUID desechable en PostgreSQL loopback y sirve la web/API en 127.0.0.1:43126.
   Workers deshabilitados; transporte de correo en memoria. Las rutas __review
   están exclusivamente en este script de prueba, nunca en la aplicación desplegada.
3. Ejecutar `tests/admin-review/client-sessions-browser.cjs` con Playwright CLI
   run-code y un navegador headed con perfil persistente dentro de output/playwright.
   Cubre formularios reales de registro/login, cookies, consentimiento, USER/FRIEND,
   renovación almacenada, access caducado, concurrencia de frontend y backend,
   caída real simulada de la consulta de sesión, error de red, logout y dispositivos.
4. Para reapertura, navegar a about:blank y usar __review/access-expired antes de
   cerrar el navegador. Reabrir el mismo perfil en about:blank y ejecutar
   `tests/admin-review/client-sessions-reopen.cjs`: configura la API local de prueba,
   abre Mi cuenta y comprueba identidad y recuperación sin otro login.
5. Enviar `stop` al script para cerrar servicios y eliminar su base desechable.

Jest usa tiempo simulado para comprobar 500 días, límites ADMIN, renovación contra
caducidad concurrente, revocación por contraseña/estado y generaciones antiguas.
Las pruebas DOM verifican que fallos temporales no generan logout ni éxito falso.
