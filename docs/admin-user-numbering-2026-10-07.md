# Numeración visible de usuarios — 2026-10-07

El listado de administración muestra N.º en lugar del ID interno. El backend
añade `registrationNumber` al DTO del listado: `ROW_NUMBER()` de las cuentas
existentes por `createdAt ASC, id ASC`. No se guarda el número, no se renumeran
claves ni se cambian relaciones. No requiere migración ni generación de Prisma.

La vista actual no tiene exclusiones permanentes de cuentas. Se numeran todas
las cuentas antes de filtrar, buscar, ordenar o paginar; una búsqueda puede
mostrar saltos. El selector N.º conserva el valor de consulta `sort=id` por
compatibilidad con enlaces anteriores y ordena por fecha/ID, como la numeración.
La ordenación por alta tiene también desempate por ID; por email, desempate
estable por ID. Los filtros y la selección masiva conservan sus reglas anteriores.

La página y el total se consultan junto con los números en una transacción
RepeatableRead. La consulta de números devuelve solo los IDs de esa página,
después de numerar el conjunto global: no descarga todas las cuentas en el
navegador ni hace una consulta por registro. Las acciones individuales y los
checkboxes de Bulk Edit mantienen `user.id`. Si faltase el número del backend,
el frontend muestra un guion, sin sustituirlo por el ID ni inventar un ordinal.

Una eliminación real compacta los números en la siguiente carga del listado.
La recarga existente actualiza filas, total y paginación, y corrige una página que
ya no exista. No hay actualmente un endpoint ni botón de eliminación de cuentas
en esta vista; no se añade una operación de borrado en este encargo. Las bajas
newsletter o cambios de estado que conserven User no quitan ni alteran su número.
Un alta con fecha posterior recibe el total actual; una fecha expresamente
retroactiva se coloca donde corresponde por fecha. No se asigna un número
permanente independiente del orden de registro solicitado.

Verificaciones locales:

- 62 pruebas de usuarios, paginación y Bulk Edit correctas; compilaciones de
  backend y administrador correctas.
- `node tests/admin-bulk/user-registration-number.cjs`: PostgreSQL local
  `127.0.0.1:5433/cronox_dev`, API y Chromium en localhost:3000, con 105 cuentas
  desechables y un SUPERADMIN temporal. Correo y trabajos externos desactivados.
- Numeración global completa 1..N; fechas iguales desempatan por ID; segunda
  página, búsqueda, filtros combinados y orden por email conservan números.
- Eliminación únicamente de un fixture intermedio: números recalculados, total
  filtrado 105→104 y segunda página 5→4 filas tras recargar. Alta posterior con
  número N. Estado/newsletter conservan número. Ver apunta al ID interno y abre
  la ficha correcta; checkbox, preview y execute de Bulk Edit usan ese mismo ID.
- Fixtures eliminados al finalizar por sus IDs; no se eliminan cuentas reales,
  no se crean pedidos ni se envían correos. Capturas y logs locales ignorados en
  `output/playwright/user-number-2026-10-07/`.

Se conserva el trabajo publicado de Bulk Edit y del resto del proyecto. Recurso
administrativo `admin.js?v=9`. Cambios preparados solo en local: sin commit,
push, despliegue, consultas a producción ni modificación de configuración.
