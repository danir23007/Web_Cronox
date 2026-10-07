# Rendimiento de Productos del administrador — 2026-10-07

Trabajo local sobre `947e3e7` (incluye la numeración de usuarios ya guardada por
el propietario). Sin commit, push, despliegue, migraciones ni cambios en productos
reales. Backend de prueba: `127.0.0.1:3000`, PostgreSQL `127.0.0.1:5433/cronox_dev`,
con correo y trabajos externos desactivados mediante `scripts/start-local.cjs`.

## Causas confirmadas y correcciones

1. **Ciclo de carga de la vista previa.** `applyPreview()` asignaba `img.src` y
   también era el manejador de `load` de esa imagen. Chromium volvía a emitir
   `load`, aun sin otra descarga HTTP. Cada vuelta escribía campos, textos y
   estilos y calculaba geometría; además activaba el observador general de tablas
   por las mutaciones de texto. Se midieron 5.845 eventos en 1,2 segundos sin
   interacción y actividad continua incluso con el modal cerrado. Ahora el recurso
   se asigna una vez por selección; el evento puede ajustar la geometría sin
   recargarlo. La clave de selección es independiente del src de reserva para
   evitar ciclos si falla una variante. El reset limpia la imagen y bind es idempotente.
2. **Originales usados como miniaturas y precarga del historial cerrado.** El
   listado pedía 50 originales de 929.647 bytes cada uno; abrir el editor descargaba
   otras ocho imágenes originales, incluidas tres archivadas. Ahora se reutiliza
   `CRONOX_IMAGES`: `small` para miniaturas y `quick` para previsualizaciones, con
   sus reservas existentes y decodificación asíncrona. El historial crea imágenes
   únicamente al abrirse. La serialización conserva URLs originales y metadatos;
   los derivados se usan solo para mostrar. El navegador puede seguir solicitando
   todas las miniaturas de una tabla aunque tengan loading=lazy: en esta prueba
   solicitó las 50, pero con un tamaño mucho menor.
3. **Respuesta del listado excesiva para esa vista.** Se enviaban todas las fotos
   activas y descripción/keywords que no se muestran en las filas. La tabla pide
   `view=summary`: una imagen, sin descripción ni keywords. La respuesta completa
   sigue siendo la predeterminada para otros consumidores. El editor obtiene
   siempre detalle completo y fresco, con variantes, categorías, historial y coste.
4. **Peticiones en cascada y respuestas antiguas.** La apertura esperaba el detalle
   antes de pedir categorías. Ahora ambas consultas comienzan en paralelo. Un
   contador de apertura y la sección actual impiden que una respuesta anterior
   rellene o abra el editor tras cambiar de producto, cerrar o navegar. Las cargas
   de categorías conservan su protección de versión y los borradores actuales.

No se introdujo caché de datos de productos: cada apertura vuelve a consultar el
detalle, y cada guardado confirmado vuelve a cargar el listado. La caché HTTP de
recursos gráficos mantiene su comportamiento existente. No se regeneran imágenes
por editar un campo, reabrir el modal o cambiar el encuadre.

## Medición antes/después

Chromium 153, viewport 1365×900, CPU nativa, red loopback sin limitación artificial.
En cada ejecución: 51 productos desechables, tres variantes, seis imágenes activas,
tres archivadas y una categoría temporal. Las imágenes se generan con los mismos
píxeles deterministas: original 1024×1365, small 180 px y quick 720 px. Los datos
se eliminan al terminar. No son medidas del catálogo ni de la red de producción.

La primera entrada en Productos ocurre después de autenticar al administrador;
los recursos del shell ya pueden estar en caché, las imágenes de esos productos
todavía no. Se mide también la recarga posterior y la reapertura del editor.

Comparación `before.json` frente a `after-verified.json`, realizada antes del corte
de luz y con las mismas condiciones:

| Medición | Antes | Después |
|---|---:|---:|
| Transferencia al entrar en Productos | 46.696.234 B | 478.292 B |
| Imágenes solicitadas en esa entrada | 50 | 50 |
| JSON del listado | 192.703 B | 78.538 B |
| Transferencia al abrir el editor | 7.449.696 B | 440.579 B |
| Peticiones al abrir: API + imágenes | 2 + 8 | 2 + 6 |
| Eventos load de la vista previa durante apertura | 5.439 | 1 |
| Eventos load en 1,2 s de reposo del editor | 5.845 | 0 |
| Trabajo del hilo principal en ese reposo | 1.209 ms | 2 ms |
| Trabajo del hilo principal con el editor cerrado, 1,2 s | 1.191 ms | 3 ms |
| Primera entrada: tabla visible | 74 ms | 89 ms |
| Primera apertura: formulario visible | 110 ms | 135 ms |
| Recarga posterior del listado: visible | 118 ms | 132 ms |

La mejora confirmada es una reducción de aproximadamente **99% de transferencia
inicial de la tabla**, **94% de transferencia de apertura del editor** y **99,8%
del trabajo continuo del hilo principal en reposo**. No hay una mejora estable
del tiempo hasta mostrar tabla/formulario en loopback; las diferencias pequeñas
son ruido y no se presentan como una aceleración del backend. Una repetición
posterior a la corrección midió 109 ms para abrir el editor.

No se registraron tareas individuales mayores de 50 ms en esas ventanas. Eso no
descarta saturación: el fallo llenaba el hilo de miles de tareas pequeñas. Se
registraron tanto Long Tasks como TaskDuration y ScriptDuration por CDP para
distinguirlo. El contador CDP se reinicia al recargar: el delta negativo de CPU
de `list-warm` en la captura inicial se descarta, y el medidor actual contempla
ese reinicio. Las comparaciones de reposo no cruzan una navegación.

Tras cinco ciclos adicionales de apertura/cierre y GC explícito: listeners
566→564→564→564→564, nodos 9.921–9.928 y heap 3,83–3,89 MB. No se observa
acumulación sostenida de listeners en esa muestra; no equivale a una prueba de
fugas durante horas. Los contadores anteriores a GC incluyen nodos desechados.

## Backend y otras secciones

Las consultas se contaron mediante eventos Prisma, sin guardar SQL ni parámetros.
Listado completo y resumido: nueve consultas incluyendo transacción; página de
un producto también nueve. Detalle: seis; orden por stock: ocho. No apareció N+1
por fila. En este conjunto local, detalle medido directamente: 3 ms; orden por
stock: 11 ms. Completo y resumen dieron 46/13 ms en consultas consecutivas, pero
esa diferencia mezcla caché y calentamiento y no se utiliza como mejora acreditada.
No hay evidencia que justifique añadir índices o migraciones.

En la entrada se observan también dashboard (contadores) y overview de correo.
El código mantiene live-stats cada 15 s cuando el documento está visible,
overview de correo cada 30 s y contadores pendientes cada 60 s. Waitlist y
campaña de lanzamiento comprueban la visibilidad de su sección. No se ha
atribuido a esos sondeos el cuello de botella: en las ventanas de reposo medidas
no hubo peticiones HTTP mientras el ciclo de imágenes consumía todo el hilo.
No se cambió su comportamiento ni se desactivaron funciones globales.

## Verificación y reproducción

```powershell
npm --prefix cronox-backend run build:compiled
npm run admin:build
# Arrancar con scripts/start-local.cjs y esperar /api/ready HTTP 200.
node tests/admin-review/products-performance.cjs after-final
npm --prefix cronox-backend test -- --runInBand --testPathPatterns="products/|product-gallery-manager|admin-products-management|admin-bulk|product-image-resolver"
```

- 20 suites / 124 pruebas correctas; compilaciones Nest y Vite correctas.
- Navegador/API reales: edición y guardado, precio y coste privado, stock, tallas
  y variantes existentes, categorías, activación, orden de fotos, elección de
  principal, restauración del historial, filtros, paginación de 50 filas y Bulk Edit.
- Respuestas retrasadas de A/B: B conserva el texto que se acaba de escribir.
  Salir de Productos y volver durante una carga tampoco abre el resultado antiguo.
- Regresión DOM: veinte eventos load no reasignan src, el alt escrito se conserva,
  se usan derivados, el historial permanece vacío hasta abrirlo y reset limpia src.
- Pruebas de servidor existentes cubren cambios de sistema de tallas, categorías,
  seguridad, ciclo administrativo y gestión de galería. No se prueban subidas a
  almacenamiento externo ni se eliminan archivos reales.

Evidencias y capturas privadas ignoradas: `output/playwright/products-performance/`
y logs `output/playwright/products-performance-*.log`. El script limpia sus filas
y su directorio gráfico temporal. Para comparar contra el código antiguo debe
ejecutarse el mismo medidor con ese código arrancado en un checkout aislado; el
argumento `before` solo etiqueta la muestra, no cambia la implementación servida.

Límites: no se ha medido ni modificado producción. Las imágenes antiguas que no
tengan derivados usan el original como reserva; no se han transformado en masa.
Las pruebas locales no representan latencias WAN, dispositivos móviles lentos ni
catálogos de decenas de miles de productos. El coste principal reproducido sí queda
corregido y comprobado con imágenes reales servidas por el backend local.
