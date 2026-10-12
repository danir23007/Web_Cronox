# Publicación de exclusión manual, Usuarios y navegación administrativa

Publicación autorizada el 12 de octubre de 2026. Incluye las tres tareas
documentadas en `admin-manual-statistics-exclusion.md`, `admin-users-sorting.md`
y `admin-navigation.md`; sus apartados de revisión local describen las pruebas
anteriores a esta publicación.

## Migración y conservación

La migración `20261012140000_manual_statistics_exclusion` se aplicó mediante
Prisma `migrate deploy` antes de publicar los recursos y reiniciar el backend.
Se utilizó una copia temporal del esquema y del historial de migraciones, con
esa única migración pendiente. El despliegue automático vuelve a comprobar el
historial; no debe ejecutar de nuevo una migración ya terminada.

Backup previo de producción, protegido en el VPS:
`/var/www/cronox/backups/manual-statistics-2026-10-12T03-28-27-925Z.dump`.
Tamaño: 1.081.256 bytes. SHA-256:
`1c4629c6c80b4fc84e4febab1d00a6cfa08e9ca58bee6b7f5da963520339432b`.
Se verificaron el índice, la decodificación completa y una segunda copia local
ignorada por Git. Los archivos de backup contienen datos privados y no se
publican en el repositorio.

La comparación anterior/posterior de los datos originales en 14 tablas
confirmó que no se modificaron pedidos, líneas, costes, usuarios, productos,
variantes, stock, puntos, ventas, gastos ni archivos financieros/auditoría.
Las cinco compras existentes permanecen incluidas; ninguna se excluyó.
No se importaron datos locales ni se repitió la recuperación de #19/#20.

## Comprobaciones

Se reutilizan las 413 pruebas relacionadas y los recorridos locales de
escritorio/móvil ya aprobados, incluidos los 132 casos de navegación.
Las comprobaciones finales vuelven a compilar administrador/backend y pasan
las seis pruebas de publicación, las 59 pruebas de exportaciones y los smoke
tests de artefactos y backend compilado.

La verificación de producción debe contrastar el SHA de Git con el flujo
`Deploy CRONOX`, los checksums de recursos publicados, el historial/checksum
de migraciones, salud/readiness y permisos de endpoints. Los informes reales
del backend se comparan en lectura con los agregados guardados antes de la
migración, incluidos indicador y suma de la línea del gráfico.

Una comprobación mediante servicios desplegados y SSH no constituye una
comprobación de formularios autenticados en el navegador. Si no hay sesión
administrativa disponible, deben declararse pendientes la apertura de los
formularios y la revisión visual autenticada de Usuarios y del menú, aunque
los recursos publicados y las pruebas locales estén verificados.
