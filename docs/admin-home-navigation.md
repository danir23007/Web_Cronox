# Home del administrador

Implementado en local el 2 de octubre de 2026 y publicado el 3 en `2c508b7`. Conserva visitantes y correo. Home no necesita migraciones ni modificaciones del backend. El resultado de producción queda en [el registro de publicación](admin-publication-2026-10-03.md).

- `admin.html`: Home pasa a ser la primera entrada principal del menú, antes de Producto y fuera del grupo Admin. Se actualizan el encabezado inicial y las referencias visibles del antiguo Resumen; el bloque secundario se llama «Estadísticas generales».
- `assets/admin.js`: Home deja de recibir el botón Atrás creado por la configuración de secciones. El botón y su navegación en las demás secciones se conservan. Se actualizan los mensajes de carga/error de Home.
- `assets/admin-finance.js`: únicamente cambia la etiqueta del título de la página principal a Home. Dinero, cálculos, gráficos, filtros y detalles conservan su implementación.

Se mantiene `section-dashboard`, el enlace `#section-dashboard`, el fallback existente para entrar sin hash y el retorno desde `section-menu`. No se añaden rutas ni permisos. Al no crear el botón de Home, tampoco se conserva su margen o un espacio invisible; no es necesario introducir otra regla CSS.

Las referencias a los recursos modificados pasan a admin.js v5 y admin-finance.js v2 para evitar versiones en caché.

## Verificación

`npm run admin:build` y comprobación sintáctica de ambos scripts: correctas.

Playwright/Chromium con Nest y PostgreSQL efímero en loopback, en 1440×1000 y 390×844:

- Home es la primera entrada principal, fuera de subgrupos, y aparece activa.
- Abrir `/admin.html` sin hash muestra Home; el enlace anterior `#section-dashboard` sigue funcionando.
- Home no tiene ningún botón Atrás en el DOM. El encabezado empieza a 0 px del inicio de su sección, sin hueco residual ni desbordamiento horizontal.
- En Productos y Actividad el botón Atrás sigue visible y funciona con sus destinos existentes, también en móvil.
- Agrupación financiera por meses, barras de visitantes, detalle diario y filtro de anónimos siguen funcionando. Se mantienen estadísticas generales y alertas.
- ADMIN conserva Home y Usuarios; USER y visitantes sin sesión son redirigidos al login y no obtienen acceso al panel. El entorno aislado también confirma 401/403 de los endpoints administrativos mediante sus 30 grupos de integración existentes.

La función de revisión reutilizable se conserva en `tests/admin-review/home.browser.js`; [estas instrucciones](../tests/admin-review/README.md) describen el entorno aislado. Las capturas de `output/admin-home/` son resultados temporales y no se incorporan a Git. No se crearon visitas reales, compras ni operaciones sobre buzones en esa revisión local.

## Publicación comprobada

El despliegue de `2c508b7` terminó correctamente. Se comprobaron Home predeterminado y primero, ausencia de Atrás, recursos nuevos, gráficas, detalle y filtros en producción a 1440×1000 y 390×844. Las migraciones de correo y visitantes se aplicaron mediante el despliegue existente; no son necesarias por Home.

Para revisar el panel en local, ejecutar `npm run admin:watch`.
