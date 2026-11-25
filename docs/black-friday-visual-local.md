# Campaña visual Black Friday · revisión local

La fase local descrita aquí precede a la autorización posterior de publicación. La política de configuración de producción, las migraciones y las comprobaciones de despliegue están en [Black Friday · publicación autorizada](black-friday-production-release.md). El interruptor local nunca se copia a producción.

Implementación y ajustes del 25/11/2026. Sin commit, push, merge ni despliegue. Se ha conservado el estado de activación local existente, que al comenzar estos ajustes estaba **activado**. El texto español y la nueva fecha de inicio están guardados en la configuración existente, además de ser los valores predeterminados para nuevas configuraciones.

## Revisar en el administrador

1. Abrir **http://localhost:3000/admin.html#section-key-screen** con el administrador local habitual. También se accede por **Multimedia → Pantalla Clave → Campaña Black Friday**. La API conserva los mismos permisos SUPERADMIN de Pantalla Clave.
2. Pulsar **Abrir vista previa**. Elegir **Escritorio / Móvil** y **Antes del inicio / Durante Black Friday**. Antes del inicio se puede alternar **Contador sobre portada / Banner compacto**. Durante el evento se selecciona siempre el banner compacto y se deshabilita el selector de formato: la portada recupera su presentación habitual, sin contador ni título superpuestos. Todas las vistas usan la portada, el encuadre responsive, la cabecera y los componentes públicos reales. No guardan ni activan la campaña.
3. Abrir **http://localhost:3000/** con la campaña local activada. Antes del inicio, al bajar unos 135–160 px aparece el banner; al volver arriba regresa el bloque grande. El umbral depende de la altura de la portada y tiene 28 px de histéresis. Al comenzar el evento se elimina el bloque grande y el banner permanece visible incluso arriba del todo. Probar también **http://localhost:3000/tienda**, **/favoritos**, **/cesta**, **/sobre-cronox**, **/galeria** y una ficha de producto.
4. Desmarcar el interruptor y guardar para volver a la presentación habitual. Los ajustes permanecen guardados. Las pestañas locales del mismo navegador reciben la actualización de inmediato por invalidación de configuración. Otras sesiones consultan la configuración cada 60 segundos y al recuperar visibilidad; no hay consultas al servidor cada segundo.
5. Para revisar los estados temporales sin esperar, usar los selectores de la vista previa. Para una comprobación pública con fechas reales, poner el inicio antes de la hora actual y el fin después: solo aparecerá el banner compacto con **TERMINA EN**, manteniendo el texto promocional. Con el fin ya pasado se oculta la campaña y el administrador indica **Finalizada**, aunque el interruptor siga marcado. Restaurar después las fechas solicitadas y el estado de activación deseado.

Fechas guardadas y predeterminadas: inicio **26/11/2026 21:00**, fin **28/11/2026 00:00**, ambos en **Europe/Madrid**. Se almacenan como `2026-11-26T20:00:00Z` y `2026-11-27T23:00:00Z`. Los campos siguen siendo editables, convierten explícitamente Madrid independientemente de la zona del navegador y rechazan horas inexistentes o ambiguas por cambio de horario. El fin debe ser posterior al inicio.

Texto exacto guardado, editable en **Texto del banner**, utilizado antes y durante el evento:

> BLACK FRIDAY SOLO EN BLACK FRIDAY · 27/11 — DESDE EL 26/11 A LAS 21:00

La marquesina ocupa todo el espacio entre el borde izquierdo y la separación del contador fijo: aproximadamente 81 % a 1440 px y 86 % a 1920 px. La rejilla adapta ese espacio sin mover ni redimensionar el contador. La pista contiene dos grupos idénticos; cada grupo repite el texto las veces necesarias para cubrir la franja, con separación uniforme de 4 rem. El recorrido de un grupo completo cierra el bucle sin saltos. Solo la primera aparición del texto es accesible; las demás son decorativas. No se ha añadido ninguna línea morada.

Si el servidor no está iniciado, desde la raíz:

```powershell
node cronox-backend/scripts/review-black-friday.cjs
```

Este lanzador reutiliza la validación de `.env.local` y desactiva además los trabajadores de pagos, buzones y envíos. Exige PostgreSQL local y mantiene correo y trabajos generales desactivados. Nest sirve tanto frontend como API en `localhost:3000`.

## Cambios y aislamiento

- Tabla independiente `BlackFridaySettings`, con interruptor inicialmente falso, textos, fechas absolutas, colores, revisión para evitar sobrescrituras concurrentes y administrador de la última modificación. No comparte los indicadores de acceso, expiración ni lanzamiento de Pantalla Clave.
- `GET /api/black-friday` entrega solo configuración pública y hora de servidor. Fallos o tabla todavía no migrada devuelven campaña desactivada. `GET/PATCH /api/admin/black-friday` reutiliza autenticación, roles, CSRF y validación existentes.
- Componentes encapsulados en `assets/black-friday.js` y `black-friday.css`; editor independiente en `admin-black-friday.*`. No hay dependencias ni imágenes nuevas. El bloque grande, el contraste y la ocultación del texto editorial solo se aplican antes del inicio. Al comenzar, desactivar o finalizar, la portada recupera su presentación habitual, con sus ajustes intactos. El antiguo mensaje de evento se conserva guardado; la marquesina usa siempre el texto promocional configurado.
- `--header-stack-h` incorpora la altura del banner en buscador, páginas interiores, galería y producto sin cambiar el tamaño propio de la topbar. Al desactivar no queda ninguna clase o variable de campaña aplicada. El catálogo no cambia de posición durante la transición en portada.
- El contador calcula diferencias entre instantes, usando hora de servidor y reloj monotónico. La marquesina tiene una sola copia accesible; las cifras no generan anuncios cada segundo. Una descripción estable expresa fecha, zona y estado. `prefers-reduced-motion` detiene la marquesina y las transiciones de campaña.
- La vista previa reutiliza el iframe real y el permiso de encuadre del editor multimedia existente. Sus mensajes solo se aceptan del administrador padre y del mismo origen. Las selecciones de vista previa no se consideran cambios pendientes de guardar.
- Sin lógica de descuentos, precios, cupones, stock, compras ni correos. El servicio de campaña no importa ni invoca servicios de correo/apertura.

## Verificaciones realizadas

- **67 pruebas Jest correctas**: campaña, fechas/horario de verano, acceso del administrador, Pantalla Clave y encuadre de portada.
- Typecheck del backend y administrador; comprobación de sintaxis de los scripts; compilación Nest y generación del CSS minificado de portada.
- Navegador Chromium local: vistas previas de escritorio/móvil antes del inicio y durante el evento; portada y banner a 1440, 390 y 320 px; marquesina a 1440, 1920, 390 y 320 px; sin desbordamiento horizontal; geometría de catálogo estable al hacer scroll; misma fotografía y encuadre. Se verificó que los dos grupos de marquesina tienen igual ancho, cubren la franja y difieren menos de 0,01 px al comparar posiciones equivalentes a ambos lados del reinicio del bucle. El contador conserva tamaños de 18 px en escritorio y 16 px en móvil.
- Guardado, confirmación, recarga, fechas inválidas sin escritura, desactivación/reactivación conservando textos, retirada en otra pestaña y recuperación de la cabecera original. Comparación antes/después de la configuración de prerregistro y apertura: sin cambios.
- Buscador, menú móvil y carrito; diálogo de acceso anónimo por encima de la campaña; seis rutas interiores; movimiento reducido; API administrativa sin sesión rechazada.
- Inicio y fin sin recarga y salto de tiempo equivalente a una pestaña suspendida, con reloj simulado en un contexto de navegador aislado. Al inicio se elimina el bloque grande y se restaura la portada. Entrada directa, recarga y scroll durante el evento conservan únicamente el banner y el texto español. Estado **Finalizada** manteniendo el interruptor habilitado. Estas pruebas no modifican las fechas guardadas.
- Campaña desactivada: comparación de geometría y configuración de imagen contra la misma página sin ejecutar el script de campaña. Fallos HTTP 500 y fechas malformadas mantienen la tienda normal.

Las capturas de revisión están en `output/black-friday/` (ignoradas por Git), incluidas `marquee-expanded-1440.png`, `marquee-expanded-390.png` y las vistas previas. Las pruebas repetibles están en `tests/black-friday/*.cli.js`, para ejecutar con `playwright-cli run-code --filename=...` desde una sesión autenticada en el administrador local. `local-login.cjs` prepara un estado privado de sesión sin imprimir credenciales. `admin-review.cli.js` restaura los ajustes y el estado de activación encontrados al empezar. Las pruebas públicas, de marquesina y temporales usan contextos aislados con configuración simulada y no activan la campaña guardada. `update-local-settings.cli.js` guarda exclusivamente los textos y fechas solicitados en localhost, manteniendo el interruptor existente.

Límites: se ha usado Chromium con tamaños móviles emulados, no dispositivos físicos ni Safari/Firefox. El salto de pestaña suspendida se ha comprobado con reloj simulado, sin esperar un día real. No se han hecho compras ni envíos reales. La propagación entre dispositivos de una desactivación manual puede tardar hasta 60 segundos; en la misma instalación del navegador se comunica inmediatamente entre pestañas.

## Migración y futura publicación

Las migraciones `20261125120000_black_friday_visual` y `20261125130000_black_friday_spanish_defaults` están **aplicadas solo en PostgreSQL local**, `127.0.0.1:5433/cronox_dev`. La primera crea la tabla con interruptor inicialmente falso y restricción `endsAt > startsAt`; la segunda actualiza los valores predeterminados del texto y el inicio. No cambia automáticamente campañas existentes: el registro local se actualizó explícitamente a través del administrador. El cliente Prisma también está regenerado.

El lanzador local de migraciones aplicó también `20261124120000_cart_abandonment`, que ya existía y estaba pendiente. No se modificó esa migración ni se habilitaron sus envíos. Esta circunstancia se limita a la base local.

Para una futura publicación autorizada habrá que aplicar las migraciones de Black Friday que falten, generar Prisma y desplegar los archivos modificados. Los valores de una campaña existente del destino deberán actualizarse explícitamente cuando se autorice. **No se ha ejecutado ninguna de esas acciones contra producción.** La tabla nueva ausente no bloquea la tienda: la API pública oculta la campaña. Revisar entonces las migraciones pendientes del destino y su interruptor antes de publicar.
