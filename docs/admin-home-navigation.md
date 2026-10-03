# Home del administrador

Cambio local del 2 de octubre de 2026. Sin commit, push ni despliegue. Conserva las funcionalidades locales anteriores de visitantes y correo. No necesita migraciones ni modificaciones del backend.

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

Capturas y función de revisión: `output/admin-home/`. Son artefactos de validación, no archivos para publicar. No se crearon visitas reales, compras ni operaciones sobre buzones. Se cierran el navegador y los servicios de prueba al terminar.

## Publicación pendiente

Revisar estos cambios sobre los trabajos anteriores, preparar el commit autorizado y publicar mediante el despliegue existente; después comprobar los recursos v5/v2 y la navegación en producción. Home por sí solo no requiere una migración. Las migraciones pendientes de otras funcionalidades conservan su alcance y autorización separados.

Para revisar el panel en local, ejecutar `npm run admin:watch`.
