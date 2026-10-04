# CRONOX: estabilidad de Correo y menú lateral

Se revisó el código final de `096dc11`, conservando la eliminación de borradores, la política de enviados, el historial y la atribución de campañas. No hay AGENTS.md en el repositorio ni sus directorios ascendentes; se leyeron las referencias del administrador y las instrucciones de revisión local.

## Causas y correcciones

El polling de Correo llamaba a `renderOverview()` y `list()` cada 30 segundos. Ambas funciones reemplazaban HTML, y `list()` vaciaba primero los mensajes para mostrar Cargando. La reproducción en navegador, acelerando únicamente ese intervalo de prueba, registró **10 reemplazos en cinco ciclos sin novedades**.

Las comprobaciones periódicas siguen consultando metadatos, permisos, estado del mensaje abierto y avisos. La sincronización del trabajador no se ha cambiado. El cliente reconcilia nodos por ID: conserva botones, filtros y filas existentes, y modifica solamente atributos, texto o filas que realmente difieren. No muestra Cargando durante una comprobación de fondo. Un fallo real aparece en el área de estado y deja disponible la lista anterior.

Los mensajes se obtienen con los filtros y la página actuales en el servidor; la incorporación no hace peticiones para marcar leído. Se conserva el lector y no se renderizan los formularios que se estén editando. Las actualizaciones del estado de salida solo se dibujan si los datos han cambiado. El anclaje del scroll distingue el contenedor de la lista en escritorio y el documento en móvil; al estar al principio de la lista, el nuevo mensaje puede verse normalmente.

Hay un solo intervalo por inicialización y una sola comprobación periódica en curso. Un polling no interrumpe una petición explícita de la lista. Los números de petición y la época de estado descartan respuestas antiguas, incluidos errores y avisos; al ocultar Correo se invalidan las peticiones del lector y la lista y se cancela la búsqueda pendiente. Fuera del apartado siguen consultándose contadores y avisos, sin actualizar una lista oculta. Volver a entrar o recargar el navegador carga datos actuales. No se ha añadido un botón Actualizar.

El menú abría subpaneles en el flujo vertical: una cabecera se desplazó **205 píxeles** al abrir otro grupo durante la reproducción. Ese desplazamiento podía poner otra cabecera bajo el mismo puntero y generar ciclos de entrada/salida. Además, la prioridad del foco en un panel podía impedir que se mostrase el grupo temporal solicitado con el ratón.

En escritorio, los paneles aparecen junto a las cabeceras y no alteran sus posiciones. En móvil mantienen su disposición en línea. La cabecera y el panel siguen perteneciendo a una misma zona de interacción. El estado visible es el grupo temporal o, en su ausencia, el fijado; se cierran los otros paneles antes de abrir el seleccionado. El foco ya no impone un grupo diferente al hover. Cerrar el fijado suprime su reapertura por hover hasta abandonar la zona. No se han añadido retardos, transiciones de altura ni persistencia para el hover.

Multimedia → Galería → Mosaico/Carrusel permanece anidado. Se conservan rutas, permisos y resaltado; Enter/Espacio usan botones nativos, Escape permite cerrar paneles, y aria-expanded y hidden se actualizan conjuntamente. El panel principal se ajusta al alto disponible y se reposiciona al cambiar el viewport o el scroll del menú.

## Verificación

- **123 pruebas unitarias en 11 suites**: incluye dos pruebas nuevas de reconciliación sin mutaciones, llegadas filtradas, single-flight, errores, respuestas antiguas y reinicialización sin intervalos duplicados; además de las regresiones de Correo, campañas, galería, permisos, push y atribución.
- **62 comprobaciones de integración** del harness anterior con PostgreSQL efímero, SMTP/TLS loopback e IMAP simulado, conservando migraciones y políticas de enviados.
- `tests/admin-review/mailbox-stability.browser.js`: escritorio 1440px y móvil táctil 390px, claro/oscuro. Cinco callbacks de comprobación por combinación sin novedades producen cero mutaciones en la lista, conservando los nodos, foco y ambos tipos de scroll. Prueba llegada única, búsqueda/estado/paginación, contadores, lector, borrador de respuesta, campaña, error 503, respuesta retrasada y salida/reentrada con un único intervalo.
- En el mismo navegador: fijación, recorridos lentos y rápidos por varios grupos, geometría inmóvil de cabeceras, restauración del fijado, nuevo fijado por clic, cierre sin reapertura, ausencia de fijado, Enter/Espacio, Galería anidada, navegación a ambos modos y pulsaciones táctiles. Capturas de las cuatro combinaciones bajo `output/playwright/stability-*.png`.
- Regresión en navegador de eliminación de borradores, conflictos y contenido inmutable del historial mediante el test de la entrega anterior.
- Compilación del administrador, comprobación de sintaxis y `git diff --check`.

Reproducción local:

```powershell
npm run admin:build
npm run build:compiled --prefix cronox-backend
node cronox-backend/scripts/review-mailbox.cjs --serve
# En otra terminal, ejecutar cada revisión de navegador de forma secuencial.
npx --yes --package @playwright/cli playwright-cli -s=cronox-stability open http://127.0.0.1:43121/__mailreview/superadmin
npx --yes --package @playwright/cli playwright-cli -s=cronox-stability run-code --filename tests/admin-review/mailbox-stability.browser.js
npx --yes --package @playwright/cli playwright-cli -s=cronox-stability run-code --filename tests/admin-review/mailbox-sent-policy.browser.js
npx --yes --package @playwright/cli playwright-cli -s=cronox-stability close
```

El nuevo test intercepta los datos de Correo y sus acciones; no permite conexiones externas ni mutaciones reales de otros servicios. Invoca el callback real del polling de manera controlada, manteniendo los 30 segundos del producto. Para apagar el harness, escribir `stop` en su terminal. No hubo correos reales, cambios del proveedor, migraciones de producción, push ni despliegue.
