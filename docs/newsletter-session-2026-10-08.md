# Newsletter: una aparición automática por sesión

Corrección local revisada el 8 de octubre de 2026. Sin commit, push ni despliegue. Se buscaron `AGENTS.md` en el repositorio y sus ascendientes; no se encontró ninguno. No se han modificado backend, cuentas ni suscripciones reales para esta corrección.

## Causa

`newsletter-visit.js` solo consultaba y guardaba `cronoxNewsletterShown` cuando había consentimiento de preferencias. Para un visitante anónimo que rechazaba las cookies, únicamente se recordaba la aparición en memoria: al navegar o recargar se perdía. Además, `cookie-consent.js` incluía esa clave entre los datos opcionales que limpiaba al rechazar preferencias, también durante la inicialización de cada página.

La lógica anterior tenía un plazo adicional de 20 minutos en localStorage. El reintento de apertura después de otro modal comprobaba el estado en memoria y la autenticación, pero no volvía a consultar la marca de sesión. La autenticación ya tenía un estado explícito `unknown`/`anonymous`/`authenticated`, que se ha conservado.

## Cambios

- `cronox-front/assets/newsletter-visit.js`: clave común `cronoxNewsletterShown` en sessionStorage, independiente de cuenta y consentimiento. Se registra inmediatamente antes de hacer visible la primera apertura automática. No hay exclusión permanente ni plazo en localStorage. La instancia compartida y su temporizador sobreviven a una segunda carga del script; los eventos repetidos no duplican la programación. Se vuelve a consultar la marca al vencer el temporizador y se cancela al registrar la aparición.
- `cronox-front/assets/app.js`: todas las llamadas automáticas, incluido el reintento de 500 ms cuando otro modal bloquea la pantalla, pasan por `shouldShowNewsletter()` justo antes de abrir. Ese control exige autenticación resuelta como anónima, ausencia de usuario y marca de sesión libre. Si falta el controlador, no se abre automáticamente. Al mostrarlo se cancelan tanto la espera inicial como el reintento pendiente.
- Se reutilizan `CRONOX_AUTH_STATE`, `CRONOX_USER`, `cronox:authResolved` y `cronox:userChanged`. Con autenticación desconocida no se programa; un usuario autenticado queda excluido sin importar su suscripción. Al autenticarse se cancela la espera y se cierra un popup que estuviera abierto.
- La apertura voluntaria desde el formulario del pie de página sigue funcionando aunque la aparición automática esté consumida. Una suscripción voluntaria aceptada también impide posteriores avisos automáticos durante esa sesión. Se mantienen validación, envío protegido con CSRF, errores, reintento, confirmación, foco y diseño.
- `cronox-front/assets/cookie-consent.js`: la marca de sesión ya no se elimina al rechazar preferencias. Se conserva la limpieza del antiguo `cronoxNewsletterDismissedAt`, que ya no se lee ni escribe para decidir aperturas.
- Referencias de caché actualizadas en todas las páginas que usan los recursos: `app.js?v=88`, `newsletter-visit.js?v=2` y `cookie-consent.js?v=8`. Se actualizó la descripción del almacenamiento en `cookie-policy.html` para reflejar el funcionamiento real y eliminar el plazo antiguo.

Solo index contiene la estructura del popup y carga su controlador. Las páginas de productos y demás páginas comparten origen y conservan la marca de sessionStorage; al regresar al catálogo no se vuelve a programar.

## Verificación

**52 pruebas, cuatro suites, correctas**:

```powershell
npm test --prefix cronox-backend -- --runInBand src/frontend/newsletter-visit.spec.ts src/frontend/newsletter-auth-visibility.dom.spec.ts src/frontend/newsletter-popup-management.dom.spec.ts src/frontend/cookie-consent.spec.ts
```

Cubren registro inmediato sin consentimiento ni cierre, recarga con la misma sesión, sesión nueva, ausencia de plazos persistentes, deduplicación, cancelación, relectura al vencer el temporizador y reintento detrás de otro modal; autenticación lenta o fallida, usuarios suscritos/no suscritos, roles restaurados, inicio de sesión antes del vencimiento y cierre al autenticarse; apertura y suscripción voluntarias; conservación de la marca al rechazar cookies; errores de envío y reintento del formulario. Sintaxis de los tres scripts y de los dos recorridos de navegador: correcta. `git diff --check`: correcto.

**Chromium real contra localhost:3000, correcto**. Se usó la habilidad Playwright y su CLI, con los recursos reales de la tienda y respuestas controladas para autenticación, newsletter y carrito. Los productos se consultaron por GET al backend local. Las escrituras de los recorridos se interceptaron: no hubo registros, suscripciones, correos ni sesiones reales creadas por estas comprobaciones.

```powershell
npx --yes --package @playwright/cli playwright-cli -s=newsletter open http://localhost:3000 --headed
npx --yes --package @playwright/cli playwright-cli -s=newsletter run-code --filename tests/newsletter/review-session.cli.js
npx --yes --package @playwright/cli playwright-cli -s=newsletter run-code --filename tests/newsletter/review-auth.cli.js
```

| Caso | Resultado comprobado |
| --- | --- |
| Anónimo sin preferencias aceptadas | Una apertura; marca `true` ya antes de cerrar; ningún temporizador pendiente |
| Script recargado y tres eventos de autenticación anónima repetidos | Exactamente un temporizador de 5500 ms y una aparición |
| Cierre sin suscribirse | No reaparece después de esperar más que el plazo inicial |
| Dos productos distintos, FAQ y vuelta al catálogo | Marca conservada; cero aperturas adicionales; ningún temporizador pendiente |
| Recarga y volver atrás | Marca conservada; popup oculto |
| Apertura voluntaria tras consumir el límite | Abre; la validación del formulario sigue funcionando |
| Autenticación pendiente durante más de 5500 ms | Estado desconocido, popup oculto y ningún temporizador |
| Sesión válida, suscrito y no suscrito | Popup oculto antes y después de recargar; ningún temporizador |
| Inicio de sesión por el formulario antes del vencimiento | Espera cancelada; permanece oculto después del vencimiento |
| Sesión independiente nueva | Puede mostrarlo nuevamente y registra su propia marca |
| Autenticación con popup automático ya abierto | Se cierra y no quedan temporizadores pendientes |

Los dos recorridos terminan sin errores JavaScript. Los HTTP 401 de las respuestas anónimas son deliberados. Se inspeccionaron visualmente las capturas; no se modificaron los estilos ni la estructura del formulario.

## Evidencias locales

- [Primera apertura anónima](../output/playwright/newsletter-session/first-anonymous.png).
- [Apertura voluntaria después del límite](../output/playwright/newsletter-session/manual-after-limit.png).
- [Sesión autenticada suscrita](../output/playwright/newsletter-session/authenticated-true.png) y [no suscrita](../output/playwright/newsletter-session/authenticated-false.png).
- [Resultado anónimo y navegación](../output/playwright/newsletter-session/session-cli-result.txt).
- [Resultados de autenticación y sesión nueva](../output/playwright/newsletter-session/auth-cli-result.txt).

Las evidencias están en `output/playwright/newsletter-session/`, ignorado por Git. Si el navegador bloquea completamente sessionStorage, existe una protección en memoria para la página actual; no se sustituye por una exclusión persistente en localStorage.
