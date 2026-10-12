# Menú administrativo compartido

## Causas confirmadas

`admin-user.html` conservaba una copia antigua del menú: faltaban Puntos de
venta y otros destinos presentes en `admin.html`, y usaba versiones antiguas de
los recursos de la barra. `admin-launch.html` era una vista independiente sin
barra. Además, el saneamiento de los filtros de Usuarios podía sustituir el hash
de otra sección durante la inicialización de una página nueva.

## Corrección

`assets/admin-navigation.js` es la fuente única de los enlaces y grupos. Las tres
páginas usan un contenedor `data-admin-navigation`, que se rellena una sola vez
antes de inicializar `admin-shell.js` y los manejadores de cada página. Se conserva
el orden y las etiquetas del menú principal. Clientes contiene Puntos de venta,
Usuarios, Círculos y Pedidos, en ese orden.

La ficha del cliente y la vista de apertura navegan a los destinos canónicos de
`admin.html`. La vista de apertura mantiene su contenido y la consulta existente;
incorpora la barra solo tras comprobar una sesión administrativa autorizada.
Los estilos de la vista previa quedan acotados para no alterar la barra.

La política de visibilidad sigue admitiendo ADMIN y SUPERADMIN. En el panel
principal, Puntos de venta usa explícitamente el permiso `finance` ya existente.
No se han cambiado guardias, roles ni permisos del backend. Un usuario ordinario
no puede acceder a los endpoints y no recibe un menú administrativo utilizable.
El resaltado y la apertura de Clientes usan el manejador compartido existente.

El saneamiento de Usuarios se ejecuta únicamente al entrar en esa vista o leer
su propio hash: conserva ID descendente y elimina el filtro de estado antiguo,
sin redirigir las demás secciones al listado de Usuarios al recargar.

## Archivos

- `cronox-front/assets/admin-navigation.js`: nueva fuente común.
- `cronox-front/admin.html`, `admin-user.html`, `admin-launch.html`: contenedores,
  orden de carga y referencias de caché.
- `assets/admin.js`, `assets/admin-user-shell.js`, `assets/admin-launch.js`:
  permisos de interfaz, destino y saneamiento de rutas.
- `src/admin/admin-user.ts`, `src/admin/globals.d.ts` y el recurso compilado
  `assets/admin-user.js`: integración del menú tras verificar la sesión.
- Pruebas de navegación, categorías y galería; servidor desechable
  `scripts/test-manual-statistics-db.cjs`; escenario
  `tests/admin-review/admin-menu-browser.cjs`.

Las páginas de autenticación conservan su flujo y no muestran el menú privado.
Los alias `/admin` y `/admin/` conservan sus redirecciones 307 a `admin.html`.

## Verificación local

El recorrido del navegador incluye los 25 destinos del menú: Home, Productos,
Categorías, Stock, Waitlist, Favoritos, Códigos, Dinero, Mapa, Mosaico, Carrusel,
Tienda, Pantalla Clave, Newsletter, Puntos de venta, Usuarios, Círculos, Pedidos,
Plantillas mails, Buzones, Nueva campaña, Notificaciones push, Actividad, Footer
y Live stats. Incluye solicitudes 2→3/3→4, los alias de productos/galería,
`admin-user.html`, `admin-launch.html`, `/admin` y `/admin/`: 33 entradas.

Se verifican desde cada entrada Clientes desplegable, enlace a Puntos de venta,
carga de su listado real, `aria-current`, grupo abierto, recarga y vuelta; con
ADMIN y SUPERADMIN comprobados explícitamente mediante `/api/me`, a 1440 px y
390 px. Los permisos de los datos de cada módulo siguen vigentes: por ejemplo,
el detalle privado del cliente mantiene su restricción para ADMIN.

El montaje de pruebas utiliza PostgreSQL y Nest reales, JWT con la cookie actual
`jwt`, la vista SQL de visitantes y datos sintéticos. Las pruebas intensivas pueden
alcanzar el límite específico preexistente de señales de actividad de sesión;
no se ha relajado ese límite ni los permisos del proyecto. El listado de puntos
carga correctamente durante el recorrido y no hay excepciones JavaScript.

Pasan 413 pruebas automatizadas relacionadas. El recorrido completo suma 132
casos (33 entradas × dos roles × dos tamaños). La sesión USER se redirige al
acceso, sin barra administrativa, y el endpoint de puntos responde 403; sin
sesión responde 401. También pasan de nuevo los formularios reales de exclusión
manual y las ocho ordenaciones de Usuarios en ambas pantallas.

También se verifican las regresiones de exclusión manual y ordenación/facturación
de Usuarios. Las capturas están en `output/playwright/admin-menu-*.png`. El
localhost habitual conserva su base y sus datos; no hay migración nueva,
commit, push, despliegue ni modificaciones de producción.
