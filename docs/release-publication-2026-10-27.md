# Publicación CRONOX · 27/10/2026

**Publicación completada y web abierta.** SHA instalado y comprobado: **`7952ed37f84e41951b02b35a04a5b9e894772079`**. El controlador terminó `success/public_check` a las **00:20:47 UTC / 01:20:47 Europe/Madrid**. No hubo recuperación, intervención manual en datos ni despliegue alternativo.

## Integración y CI exacto

- Origen: `verify/release-20261026-linux`, código `d92b7f0633d6b29a8a5d3f4f03fc6c89cd2a3f43` y cierre documental `f7c12a6a57fcb2346e688d1a1400c102dac96999`.
- El commit `7952ed37f84e41951b02b35a04a5b9e894772079` añade únicamente el registro de autorización y omisión del iPhone. La aplicación es idéntica al código aprobado en `d92b7f06`.
- `main` local y remoto estaban en `8867cd12df8f5f444e4a4376cbb478322311e9d2`. Integración fast-forward, sin conflictos, force push, reset ni descarte de trabajo. Los 173 archivos del conjunto incluyen tipografía y composición unicode-range, contenidos interiores, footer/logos/Instagram, tarjetas/copyright, newsletter con cuenta obligatoria, sesiones, proxy/limitador compartido, concurrencia y dependencias.
- Pages confirmado en `build_type=workflow`; workflows efectivos revisados. El push a `main` solo ejecuta validación, con `deploy=skipped`.
- **[CI Linux del SHA publicado · 40424577251](https://github.com/danir23007/Web_Cronox/actions/runs/40424577251): correcto.** 3.036 pruebas / 279 suites de aplicación; 143 pruebas del controlador; 16 controles de preflight/mantenimiento; 59 pruebas / 6 suites de exportaciones. Prisma, tipos frontend/backend, ambos builds, guardias de secretos/sandbox, recursos aprobados y smoke compilado correctos.
- **[Deploy CRONOX · 40425075658](https://github.com/danir23007/Web_Cronox/actions/runs/40425075658): correcto.** Una única solicitud `workflow_dispatch`, `publish=true`, `main` contrastado con el mismo SHA. `verify-release` volvió a pasar como exige el workflow; `deploy=success`.

Este cierre es exclusivamente documental y no solicita otra publicación. El SHA funcional publicado sigue siendo `7952ed37f84e41951b02b35a04a5b9e894772079`.

## Controlador, respaldo y migración

Se utilizó exclusivamente el controlador instalado mediante Actions. Secuencia completada: preflight → mantenimiento (503 observado en ambos dominios) → parada de escritores → respaldo → restauración y comparación aislada → instalación/builds → `prisma migrate deploy` → arranque pausado y gates → activación y avance del worker → reapertura y comprobación pública.

El respaldo contiene aplicación, configuración privada y base de datos según el contrato del controlador. La restauración real aislada comparó **297 objetos, cero diferencias**. No se descargaron ni publicaron respaldos o credenciales. El controlador privilegiado conserva su hash `98f2e45282bfce99688dfbb3db9f0b183b001069ece612a3e299458099bc98e3`; no se modificaron permisos ni servicios fuera del procedimiento.

**Única migración aplicada:** `20261026180000_storefront_concurrency`, checksum SHA-256 `8ab1ad256ad0139ab7770b30355e1c2d40ecc3e15306a35d7a6e05d757c792bb`. Resultado consultado en servidor: **104 migraciones terminadas, ninguna fallida/revertida**; las 103 filas históricas permanecen intactas, incluida `20261019100000_mail_template_private_metadata`. Existen `CartOperation` y `RequestRateWindow`, ambas con RLS. No hay privilegios predeterminados adicionales en el esquema revisado. No se usaron reset, db push, seed ni reparaciones históricas.

El checkout Windows utiliza CRLF después del cambio de rama; su hash de archivo puede diferir. El blob Git, el ensayo Linux y el checksum aplicado coinciden en `8ab1ad…`. No se editó la migración para ajustar esa diferencia de representación.

## Verificación independiente de producción

| Comprobación | Resultado |
|---|---|
| Identidad | HEAD del VPS igual al SHA publicado; proceso nuevo `cronox`, PID `3778792`, online, listener solo `127.0.0.1:3000`. |
| Disponibilidad | `health` y `ready` 200 en apex y www; portada apex 200; www 308 hacia apex; HTTP 301 a HTTPS. Mantenimiento retirado. |
| Procesos | Mismo PID y contador de reinicios entre las comprobaciones posteriores. Worker habilitado, escaneo avanza de 00:21:01 a 00:26:56 UTC, `lastScanError=null`. |
| Historial y trabajo previo | Historial de migraciones intacto; archivo histórico privado del checkout conserva su huella. Sin cambios de fuentes productivas fuera de Git. Se mantienen los artefactos de dependencias generados por el mecanismo oficial. |
| Proxy y límites | Guard compilado utiliza identidad de cliente validada y almacenamiento PostgreSQL. `TRUST_PROXY_HOPS=0`, Nginx conserva el contrato de `X-Real-IP`; no se cambiaron cuotas ni configuración durante la publicación. |
| Rutas | Tienda, ficha real, cesta, favoritos, cuenta, checkout y todos los destinos actuales del footer responden 200. Cuenta sin autenticar vuelve al acceso habitual; favoritos pide iniciar sesión. |
| Recursos/caché | `app.js?v=104`; HTML `no-store`. Los 12 recursos revisados (JS, CSS, fuentes, logos e Instagram) responden 200 y coinciden con las fuentes publicadas, normalizando solo LF/CRLF en texto. Fuentes Cormorant y fallback cargadas en navegador. `customer-fonts.css` se importa desde `customer-typography.css`. |
| Visual | Chromium, viewports 1366×900 y 390×900: sin desbordamiento horizontal ni imágenes rotas al terminar de cargar; newsletter 1 línea por texto en escritorio, ajuste natural en móvil; tres logos blancos en columna e Instagram único a la derecha; precios junto a nombres. |
| Footer y copyright | Desplegables móviles abren su contenido sin recortarlo. Copyright al final del documento; favoritos anónimo corto termina exactamente en el viewport de 900 px, con margen izquierdo. Páginas largas desplazan el pie con el documento. |
| Carrito y checkout | Cesta anónima propia: añadir una unidad de SCARRED TEE red M, subtotal 40,00 €, envío 2,95 €, total 42,95 €; abrir checkout con resumen 200. Formulario y Payment Element cargan sin introducir contacto/dirección/tarjeta ni confirmar pago. Eliminar la unidad, recargar y consultar servidor: 0 elementos. No se modificó una cesta de cliente. |
| Errores observados | Sin excepciones JavaScript de página. Los 401 son peticiones protegidas sin sesión. El resumen de checkout vacío devuelve 400 `EMPTY_CART`: «No puedes iniciar el checkout sin productos en el carrito.»; con producto devuelve 200. Los 503 de la pestaña abierta durante mantenimiento quedan separados de las comprobaciones posteriores. No se observaron nuevos 429/500. |
| Logs | El log de errores PM2 permanece en 55.685 bytes, sin entradas nuevas; el incremento del log de salida corresponde a arranques/rutas, sin clases de error nuevas. No se acreditan lecturas de logs Nginx privados a los que `deploy` no tiene acceso. |

Las capturas iniciales tomadas antes de decodificar imágenes no se utilizan como evidencia visual final. La captura definitiva espera carga/decodificación y conserva el contenido real. No se modificó la web para realizar las capturas.

Evidencia local, fuera de Git: `output/release-publish-20261027/` (manifest, estados de Actions/controlador, lecturas antes/después, HTTP, navegador y carrito). Capturas definitivas: [footer escritorio](../output/playwright/release-publish-20261027/footer-final-1366.png), [footer móvil](../output/playwright/release-publish-20261027/footer-final-390.png), [página corta](../output/playwright/release-publish-20261027/favorites-short-390.png), [contenido legal largo](../output/playwright/release-publish-20261027/privacy-long-390.png). No se incorporan perfiles, `.env`, bases ficticias ni archivos temporales al commit.

## Alcance y limitaciones conservadas

- **iPhone físico: no realizado y omitido expresamente por el titular.** El entorno de revisión no cargaba correctamente sus recursos. No se ha preparado otro sandbox ni se ha exigido repetir la prueba; el viewport de Chromium no la acredita.
- No se ha utilizado una cuenta de cliente autenticada de revisión en producción: no había una sesión de revisión disponible en el entorno automatizado. El acceso a cuenta/favoritos se comprobó como visitante. Registro completo, newsletter atómica y persistencia/login/logout conservan la evidencia aislada y de CI del informe de preparación; no se presentan como altas o sesiones nuevas verificadas en producción.
- Tarjeta, rechazo, reintento y 3DS conservan las pruebas sandbox con webhooks originales de la [preparación](release-readiness-2026-10-26.md). Apple Pay, Google Pay, PayPal, Bizum, Klarna, Revolut Pay, Amazon Pay y otros métodos no tienen una nueva transacción acreditada. La visualización de botones en producción no demuestra un pago.
- Se conserva el aviso de `deepmerge-ts` limitado al CLI de Prisma, considerado no bloqueante por las condiciones documentadas en la [matriz de dependencias](release-dependencies-2026-10-26.md). No se rebajan validaciones ni se fuerza una migración mayor.
- No se han creado usuarios/pedidos ficticios, cobrado dinero, reenviado bienvenidas, reencolado históricos ni enviado campañas. La activación normal de trabajos operativos sigue la política productiva existente.

**Resultado:** versión publicada, operativa y sin impedimento nuevo detectado. Los límites de aceptación anteriores siguen explícitos; no se necesita una recuperación ni otra publicación para completar este despliegue.
