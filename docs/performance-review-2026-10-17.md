# Optimización de rendimiento de CRONOX — 17 de octubre de 2026

Trabajo conservado y validación ampliada en local, sin commit, push ni despliegue. La nueva comparación con CPU/red limitadas confirma menor LCP de producto (3.004 → 2.116 ms en escritorio; 2.892 → 700 ms en móvil), elimina el CLS observado de tienda y reduce el de cesta. Inicio móvil aumenta su LCP por cambio de candidato al preloader: no hay una aceleración uniforme. Se completó un pago Stripe TEST real, webhook e idempotencia de stock. Queda un diagnóstico intermitente de WebKit sin regresión funcional demostrada.

**Lectura del informe:** las secciones iniciales conservan la evidencia de la primera fase, con su configuración original. La sección final «Validación complementaria antes de publicar» contiene el estado vigente, las nuevas correcciones, mediciones y limitaciones; sus cifras no se mezclan con las históricas.

## Alcance y entorno

- Referencia inicial: `102a1b9111d91e8fb94a5b5bb91d71f3b0933d8f`, árbol de trabajo limpio. No se encontraron instrucciones `AGENTS.md` en el repositorio ni sus directorios antecesores.
- Frontend HTML/CSS/JavaScript servido por Nest; módulos de administración compilados con Vite. Backend NestJS, Prisma y PostgreSQL. Se conservan las dependencias y la arquitectura.
- Mediciones en `http://localhost:3000`, con el backend compilado y la base local `cronox_dev` en el puerto 5433. No corresponden al servidor de desarrollo de Vite ni a producción.
- Windows, Ryzen 7 7700X, Node 22.21.0 y Chromium 155.0.8059.79 mediante Playwright CLI. Las imágenes y SDK externos conservan sus URL reales.
- Escritorio: 1440×900. Móvil: 390×844, emulación táctil con DPR 1. Sin limitación artificial de CPU/red. La emulación móvil no reproduce un procesador o una conexión móvil lentos.
- Tres pares de cargas por ruta y tamaño: contexto de navegador nuevo para frío y segunda navegación en el mismo contexto para caliente. No se vacían las cachés de sistema operativo, DNS, backend ni servicios externos.
- Ventana pública: `DOMContentLoaded + 6000 ms`. CDP recoge transferencias y peticiones, incluidos recursos externos. PerformanceObserver recoge candidatos LCP, tareas largas y CLS por ventanas de sesión. Las transferencias todavía pendientes al cerrar la ventana se identifican en los datos originales.
- Perfil/administración: datos iniciales disponibles (Pedidos o filas de productos) +1000 ms, seguidos de pestañas y previews; el tráfico del recorrido completo se conserva aparte. Son 24 navegaciones válidas por fase. Las cookies renovadas pasan al siguiente contexto para respetar la rotación del refresh; la caché HTTP sigue fría en los contextos nuevos. Las calibraciones con navegación por hash sin recarga o credenciales antiguas se excluyen.
- Consentimiento esencial y popup de newsletter ya descartado, iguales en ambos estados de caché. La calibración anterior sin ese control se conserva, pero se excluye de las comparaciones.
- Un solo navegador de medición a la vez; compilaciones, codificación de imágenes y pruebas intensivas se realizan fuera de esas ventanas.

Son mediciones de laboratorio local, no datos de usuarios reales, INP de campo ni Core Web Vitals de producción. El LCP puede corresponder al preloader o a un logotipo; se conserva la identidad del elemento para interpretar cada cifra. El tiempo de salida del preloader y la disponibilidad del DOM se informan por separado cuando resultan útiles.

## Datos y límites de seguridad

El catálogo local contiene siete productos copiados previamente y tres fixtures locales preexistentes; se mantiene idéntico antes y después. La cesta de medición es una cesta anónima local aislada con un artículo. Las vistas privadas utilizan la cuenta administrativa local, sin guardar configuraciones ni cambiar los diseños de acreditación.

El cargador local verifica la base de datos y desactiva los servicios externos configurados para producción. No se realizan pedidos, cobros, envíos de correo, cambios de stock ni pruebas de carga sobre producción. Los benchmarks de escala del backend usan una base desechable con datos ficticios.

No se autoriza ni realiza commit, push, despliegue o migración de producción como parte de este encargo.

## Evidencia reproducible

Los datos detallados, capturas y arneses están en `output/playwright/performance-20261017/`, ignorados por Git. Su `README.md` describe las condiciones y los comandos de reproducción. No se incorporan credenciales, cookies ni datos privados al informe versionable.

## Problemas y cambios aplicados

Se prioriza la transferencia innecesaria en navegación y compra, seguida del trabajo oculto en el perfil y las lecturas repetidas del backend. En esta primera fase no se modificaron CSS, tipografías, dimensiones, márgenes ni separaciones de recomendados. La validación complementaria añade únicamente el ajuste del mensaje de carga de cesta descrito al final, conservando toda la geometría final.

1. **Preloader:** el original de 1280×720 ocupa 4.584.550 bytes y se muestra a unos 192 px efectivos (195,84 px durante la salida). Se añaden variantes de 320×180 y 640×360, de 410.004 y 1.410.798 bytes: **91,06 % y 69,23 % menos**. `sizes="196px"` permite elegir según densidad; la versión grande cubre DPR 3 y sirve de fallback. Se conservan original, 81 fotogramas, 30 ms por fotograma, duración de 2.430 ms, bucle y transparencia. Son derivadas con pérdida a calidad 100, no imágenes idénticas píxel a píxel. La comparación de todos los fotogramas a tamaño de presentación y las hojas de contacto respaldan su fidelidad. El script `cronox-backend/scripts/optimize-storefront-preloader.cjs` reproduce ambas variantes con la dependencia sharp existente.
2. **Ficha de producto:** la referencia descargaba tres fotos grandes de 1,24 + 1,77 + 1,32 MB sin interacción, también en móvil. Ahora servidor y cliente ofrecen las variantes existentes `card/quick/pdp` con anchuras únicas válidas y tamaños ajustados al encuadre guardado. La foto inicial sigue priorizada; las ocultas conservan `lazy` hasta seleccionarlas. El zoom pide la variante PDP de máxima calidad y su carga no restablece el zoom ni el punto de enfoque. El fallback derivado → original → placeholder funciona también después de ampliar, y termina si falla el placeholder.
3. **Tienda:** el HTML inicial de `/tienda` y categorías válidas ya no ofrece al navegador el hero de inicio oculto, cuya descarga de referencia era de unos 58 KB. Tampoco inicializa allí su lectura de configuración ni observadores. La portada conserva su carga prioritaria en inicio. La galería visible al final de la tienda se mantiene.
4. **Perfil:** se eliminan la precarga del libro inactivo y la construcción del preloader cuando sólo se intenta ocultarlo. El libro se carga al necesitarlo. Se solapan las lecturas autorizadas de estadísticas con diseño, identidad y gráficos; el estado de ascenso se consulta después de las estadísticas. Se conserva la hora de recepción para avanzar el contador correctamente. Si una promoción ocurre durante la carga y cambia el círculo de la acreditación personal, se revalidan las respuestas anticipadas antes de mostrar los controles. No hay caché persistente de datos personales.
5. **METACRILATOS:** se evitan escrituras repetidas del mismo texto del botón y los mismos atributos ARIA en cada fotograma. Se conservan frecuencia de animación, transformación, iluminación, gestos, pausa y limpieza. El experimento A/B descrito abajo justifica este cambio pequeño.
6. **Usuarios administrativos:** se pagina por ID antes de leer históricos ajenos a la página, conservando el cálculo global cuando se ordena por métricas y la misma respuesta.
7. **Reconciliación de círculos:** una cola vacía deja de abrir una transacción cada segundo; se conserva la frecuencia de comprobación y la transacción protegida para el trabajo real.

En la primera fase los recursos editados actualizaron sus URL en todos sus consumidores: `app` 95, imágenes responsive 5, encuadre 8, producto 47, perfil 31 y METACRILATOS 6. Las derivadas tienen nombres nuevos. No se añaden cachés de catálogo, precio, stock, checkout ni usuarios, ni se alteran los mecanismos existentes de invalidación.

## Navegación pública: antes → después

Medianas de tres muestras por fila; **60 navegaciones antes y 60 después**. MB decimales de transferencias completadas durante la ventana fija. E = escritorio 1440×900, M = móvil 390×844/DPR 1. Fría y caché corresponden a las condiciones descritas arriba. Todas las filas tienen mediana de tiempo en tareas largas **0 → 0 ms**.

| Ruta | Vista | Caché | MB | Peticiones | TTFB documento (ms) | LCP (ms) | CLS |
|---|---|---|---:|---:|---:|---:|---:|
| Inicio | E | Fría | 8,146 → 3,973 | 71 → 72 | 2,9 → 3,6 | 88 → 68 | 0 → 0 |
| Inicio | E | Con caché | 0,186 → 0,186 | 70 → 71 | 2,7 → 6,4 | 40 → 52 | 0 → 0 |
| Inicio | M | Fría | 7,261 → 3,087 | 68 → 69 | 3,1 → 2,8 | 84 → 64 | 0 → 0 |
| Inicio | M | Con caché | 0,186 → 0,186 | 67 → 67 | 2,7 → 2,7 | 44 → 28 | 0 → 0 |
| Tienda | E | Fría | 8,423 → 4,187 | 72 → 70 | 3,3 → 3,2 | 288 → 204 | 0,4728 → 0,4728 |
| Tienda | E | Con caché | 0,186 → 0,182 | 72 → 70 | 2,7 → 3,1 | 88 → 84 | 0,4713 → 0,4713 |
| Tienda | M | Fría | 7,533 → 3,297 | 70 → 69 | 3,2 → 3,2 | 216 → 184 | 0 → 0 |
| Tienda | M | Con caché | 0,186 → 0,182 | 69 → 67 | 2,9 → 2,8 | 88 → 84 | 0 → 0 |
| Producto | E | Fría | 5,254 → 1,068 | 48 → 46 | 4,5 → 4,9 | 192 → 120 | 0,0098 → 0,0098 |
| Producto | E | Con caché | 0,167 → 0,167 | 48 → 46 | 3,8 → 4,1 | 32 → 36 | 0,0098 → 0,0098 |
| Producto | M | Fría | 5,179 → 0,993 | 46 → 44 | 4,4 → 13,4 | 140 → 132 | 0 → 0 |
| Producto | M | Con caché | 0,167 → 0,167 | 46 → 44 | 3,8 → 4,1 | 36 → 36 | 0 → 0 |
| Cesta | E | Fría | 0,694 → 0,695 | 37 → 36 | 2,2 → 2,3 | 168 → 176 | 0,1258 → 0,1258 |
| Cesta | E | Con caché | 0,135 → 0,135 | 37 → 37 | 1,9 → 2,0 | 68 → 68 | 0,1258 → 0,1258 |
| Cesta | M | Fría | 0,694 → 0,695 | 36 → 36 | 2,3 → 2,3 | 156 → 148 | 0 → 0 |
| Cesta | M | Con caché | 0,135 → 0,135 | 36 → 36 | 1,8 → 1,9 | 68 → 68 | 0 → 0 |
| Checkout | E | Fría | 5,621 → 1,447 | 42 → 42 | 2,0 → 2,1 | 76 → 56 | 0 → 0 |
| Checkout | E | Con caché | 0,157 → 0,157 | 42 → 42 | 1,8 → 2,0 | 36 → 36 | 0 → 0 |
| Checkout | M | Fría | 5,638 → 1,447 | 42 → 42 | 2,1 → 2,0 | 80 → 60 | 0 → 0 |
| Checkout | M | Con caché | 0,157 → 0,157 | 42 → 42 | 2,0 → 1,8 | 40 → 32 | 0 → 0 |

El ahorro de primera descarga en escritorio es **51,2 % inicio, 50,3 % tienda, 79,7 % producto y 74,3 % checkout**; en móvil, aproximadamente **57,5 %, 56,2 %, 80,8 % y 74,3 %**. La cesta y las visitas con caché apenas cambian. El CLS permanece igual; no se atribuye una corrección de estabilidad visual a este trabajo.

Los tiempos no mejoran uniformemente: por ejemplo, el documento de producto móvil pasa de 4,4 a 13,4 ms y la retirada del estado de carga de 23 a 52 ms, mientras que su LCP baja ligeramente. La salida del preloader de inicio móvil pasa de 132 a 141 ms. Con tres muestras, CPU/red sin limitar y un servidor local, estas diferencias pequeñas no permiten atribuir una mejora o regresión perceptible a una causa concreta. Los ahorros de bytes sí tienen una explicación directa y repetida en los recursos eliminados o sustituidos. LCP de inicio/checkout representa habitualmente el logo/preloader.

### Interacciones

36 interacciones por fase, tres por acción/dispositivo. Se mide desde el evento real de navegador hasta estado esperado + dos fotogramas, incluyendo el sondeo de automatización. **No es INP.**

| Acción | Escritorio antes → después (ms) | Móvil antes → después (ms) |
|---|---:|---:|
| Abrir menú en inicio | 22,0 → 21,4 | 21,9 → 22,0 |
| Quick add de recomendados con disponibilidad | 27,3 → 22,8 | 22,3 → 27,4 |
| Abrir menú en tienda | 27,8 → 26,6 | 22,1 → 22,1 |
| Seleccionar talla | 9,9 → 9,7 | 9,7 → 9,6 |
| Cantidad de cesta confirmada por servidor | 25,3 → 27,7 | 24,8 → 28,6 |
| Cerrar acordeón de dirección | 15,4 → 9,8 | 11,6 → 9,8 |

No se observa un bloqueo sostenido de estas interacciones ni se afirma una aceleración general. Las 120 navegaciones públicas no registran excepciones de JavaScript. Se distinguen los 401 esperados de consultas de sesión/favoritos como invitado y los beacons locales de presencia con respuesta 204 abortados al navegar de los fallos funcionales.

### API observada en las mismas cargas

TTFB de API medido por CDP desde envío hasta cabeceras, sin añadir tráfico de benchmark. Ejemplos de medianas de tres muestras; el fichero `comparison.json` conserva los 120 grupos por endpoint/ruta/dispositivo/caché, con todas sus muestras y la primera por separado.

| API / vista | Escritorio, fría (ms) | Escritorio, caché (ms) | Móvil, fría (ms) | Móvil, caché (ms) |
|---|---:|---:|---:|---:|
| Productos, inicio | 7,22 → 10,74 | 8,20 → 9,07 | 7,35 → 7,03 | 7,84 → 8,23 |
| Productos, tienda | 15,93 → 7,44 | 7,66 → 12,41 | 6,80 → 6,39 | 10,02 → 8,38 |
| Cesta, página de cesta | 3,95 → 3,61 | 5,13 → 4,38 | 3,46 → 3,60 | 3,02 → 3,53 |
| Resumen de checkout | 3,33 → 3,63 | 3,48 → 4,30 | 3,87 → 2,98 | 3,44 → 3,67 |

La primera llamada de resumen de checkout de escritorio fue 124,86 ms antes y 30,79 ms después; no se confunde ese calentamiento con sus medianas sostenidas de unos 3–4 ms. La ficha aprovecha el producto incluido por el servidor en el documento, sin un GET adicional de detalle en estas muestras. No se atribuye a las optimizaciones una mejora del tiempo de estas API, cuyos contratos y cálculos se conservan.

## Perfil y administración: antes → después

**24 navegaciones antes y 24 después**, con la ventana privada descrita en el método; medianas de tres muestras por fila. `Datos listos` es el momento en que se dispone de los pedidos o las filas de productos, no una métrica de pintado. Mediana de tareas largas: **0 → 0 ms** en todas las filas.

| Vista | Tamaño | Caché | MB | Peticiones | TTFB (ms) | LCP (ms) | CLS | Datos listos (ms) |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Perfil | E | Fría | 6,216 → 0,888 | 53 → 50 | 0,9 → 0,7 | 68 → 60 | 0,0030 → 0,0030 | 156 → 124 |
| Perfil | E | Con caché | 0,205 → 0,203 | 53 → 50 | 2,4 → 2,3 | 40 → 40 | 0,0030 → 0,0030 | 77 → 72 |
| Perfil | M | Fría | 6,216 → 0,888 | 53 → 50 | 0,7 → 0,7 | 64 → 56 | 0 → 0 | 141 → 124 |
| Perfil | M | Con caché | 0,205 → 0,203 | 53 → 50 | 2,1 → 2,0 | 28 → 32 | 0 → 0 | 73 → 72 |
| Admin | E | Fría | 1,652 → 1,653 | 85 → 85 | 6,5 → 7,6 | 188 → 188 | 0,0272 → 0,0272 | 204 → 207 |
| Admin | E | Con caché | 0,258 → 0,258 | 85 → 85 | 7,8 → 7,9 | 128 → 140 | 0,0272 → 0,0272 | 155 → 141 |
| Admin | M | Fría | 1,652 → 1,653 | 85 → 85 | 6,8 → 5,8 | 184 → 188 | 0 → 0 | 179 → 183 |
| Admin | M | Con caché | 0,258 → 0,258 | 85 → 85 | 4,7 → 6,3 | 136 → 124 | 0 → 0 | 141 → 119 |

El perfil elimina **5,33 MB de su carga inicial (85,7 %)**. La administración permanece prácticamente igual con los datos locales; el beneficio del listado de usuarios a mayor escala se mide por separado en PostgreSQL. No se cambia su interfaz ni se afirma una aceleración general de sus pantallas.

Abrir la acreditación activa tarda 129 → 117 ms en escritorio/frío, 83 → 85 ms con caché; en móvil, 101 → 93 ms y 70 → 64 ms. Las primeras doce mediciones de geometría al revelarla conservan el marco de 296×557 px en escritorio y 302×542 px en móvil. El solapamiento de lecturas elimina una dependencia secuencial; estos pocos milisegundos locales no prueban por sí solos una mejora en conexiones reales.

El recorrido privado incluye Pedidos → Acreditación → Cuenta → Acreditación, editor de producto abierto/cancelado, usuarios, finanzas, listado de acreditaciones y previews de **ORIGINAL y METACRILATOS**, sin guardar ni activar diseños. No se registran excepciones JavaScript ni respuestas HTTP fallidas; las cancelaciones de presencia al navegar se conservan aparte. Los hashes SHA-256 de la respuesta completa de configuración de acreditaciones y de la cesta de la cuenta coinciden al principio y al final.

La cuenta real local está en círculo V y usa METACRILATOS. Su nombre, ID y QR se comparan con la API; el QR renderizado se decodifica fuera del navegador y su contenido coincide por hash, sin incluir el token en el informe. ORIGINAL se comprueba en la vista previa administrativa con su configuración real y la identidad ficticia del preview, y en el perfil mediante fixtures. Los cinco círculos, contadores y el cruce de ascenso durante la carga se cubren con DOM/API simuladas y pruebas del backend/DB aislada, sin cambiar el círculo de la cuenta real ni activar otro diseño.

Fuera de la ventana inicial, una apertura del listado de acreditaciones registró una tarea de 75 ms (escritorio con caché, tercera repetición). Se conserva como observación aislada; el valor cero de la tabla no describe todo el recorrido administrativo.

Con la acreditación oculta, una observación de diez segundos mantiene CPU baja: 27,6 → 25,1 ms en escritorio y 21,5 → 25,6 ms en móvil, sin peticiones. Son observaciones individuales de control, no un nuevo benchmark de ahorro. Para la animación visible se utiliza el A/B repetido de la siguiente sección.

## Animación de acreditación: comparación controlada

Tres pares intercalados de diez segundos en escritorio, misma cuenta/API/activos y captura rAF en ambos brazos. Sólo se sustituye el script del renderer por su versión original o candidata. CPU es `TaskDuration` del hilo principal, no uso total del equipo.

| Par | CPU original | CPU optimizada | Reducción |
|---|---:|---:|---:|
| 1 | 2.736 ms | 2.316 ms | 15,3 % |
| 2 | 2.708 ms | 2.250 ms | 16,9 % |
| 3 | 2.849 ms | 2.316 ms | 18,7 % |

La mediana baja **2.736 → 2.316 ms (15,3 %)**. Ambos brazos mantienen aproximadamente 163–165 fps en esta pantalla, sin limitar la frecuencia; las geometrías y firmas de identidad/QR coinciden y no aparecen tareas largas. Esta medición es distinta de la carga inicial de página. El consumo con la pestaña de acreditación oculta ya era bajo, por lo que se conserva su mecanismo de suspensión.

## Backend y acceso a PostgreSQL

El listado administrativo ordenado por ID pagina dentro de PostgreSQL antes de cargar las métricas financieras. Conserva filtros, orden, total, respuesta y snapshot `RepeatableRead`. Las ordenaciones por métricas siguen calculándose sobre todo el conjunto necesario. Una primera página incompleta permite conocer el total sin ejecutar otro `COUNT`.

La cola de reconciliación comprueba si hay trabajo antes de abrir una transacción. Conserva la cadencia de un segundo, transacción serializable, bloqueos de fila, reintentos y comprobación de versión al consumir. La comprobación añade una lectura por invocación cuando hay trabajo; en vacío elimina tres sentencias de control transaccional.

Benchmark local del servicio en proceso, no del endpoint HTTP: una llamada inicial y mediana de cinco repeticiones calientes; veinte para la cola vacía. Mismos datos ficticios, una conexión Prisma y bases desechables. La transpilación y el cálculo de tamaños quedan fuera del cronómetro; las cachés de PostgreSQL/SO no están frías. Cada usuario ficticio tiene cuatro pedidos pagados de 25 € y 100 € netos, con triggers financieros reales.

| Caso | Mediana antes → después | Rango caliente antes → después | Sentencias SQL | Filas devueltas por operaciones ORM |
|---|---:|---:|---:|---:|
| ID, 100 usuarios / 400 pedidos | 19,38 → 20,00 ms | 18,58–21,90 → 19,32–22,33 ms | 11 → 12 | 900 → 900 |
| ID, 500 usuarios / 2.000 pedidos | 75,82 → 18,10 ms | 75,21–81,07 → 17,73–19,38 ms | 35 → 12 | 4.500 → 900 |
| Cola vacía | 0,51 → 0,24 ms | 0,43–0,63 → 0,21–0,32 ms | 4 → 1 | 0 → 0 |

En el caso de 500 usuarios, el tiempo baja un 76,13 % y los resultados ORM serializados pasan de 1.520.773 a 305.112 bytes. La respuesta conserva 38.997 bytes y coincide la firma de sus metadatos, IDs y métricas financieras verificadas. Los trece casos conservan las firmas de sus campos de control; no son hashes de respuestas completas. Estos bytes no son tráfico de red PostgreSQL; las filas excluyen relaciones anidadas. Las sentencias incluyen `BEGIN`, `SET TRANSACTION` y `COMMIT`: la cola vacía sigue haciendo **un SELECT**.

El ahorro del listado aparece al excluir históricos de otras páginas. Con 100 coincidencias exactas se añade un `COUNT`, sin ahorro de filas ni mejora de tiempo demostrada. Una primera página de menos de 100 usuarios —como los 51 clientes conocidos de la revisión anterior de producción— no añade ese `COUNT`. No se ha medido ni modificado producción en este encargo.

No se añaden índices ni migraciones. Los planes observados ya eran rápidos y estaban en buffers: 500 usuarios, 0,171 ms; 2.000 pedidos, 0,370 ms; 200 archivos financieros, 0,047 ms. El coste estaba en transferir al ORM y procesar históricos innecesarios para la página solicitada.

## Decisiones conservadoras y mejoras pendientes

- **CLS de tienda y cesta:** el pendiente de la primera fase se ha abordado en la validación complementaria mediante el HTML inicial del catálogo real, controles de envío iniciales y posición del mensaje de carga. Véanse causas, geometrías y métricas finales abajo; permanece un residuo pequeño de cesta.
- **Búsqueda pública de catálogo a gran escala (`/api/products`):** con 500 coincidencias ficticias se hidratan unos 1,76 MB de resultados ORM para responder unos 35 KB/10 productos. El orden global por relevancia necesita ese conjunto en la implementación actual. Se documenta para un cambio específico de búsqueda con equivalencia de resultados; el catálogo local pequeño no justifica ampliar ahora ese riesgo.
- **Paneles administrativos ocultos:** no se observó descarga de listas de mensajes oculta ni consumo significativo con los datos locales (unos 110 ms de CPU en 65 s en reposo). Se conserva su polling. La ausencia local de carpetas importadas limita esta conclusión; no prueba cómo se comportaría un buzón grande.
- **Fuentes, CSS y scripts:** la referencia no mostró un cuello de botella sostenido del hilo principal en las rutas públicas (mediana de tareas largas cero). Se conservan tipografías, pesos y orden de los scripts con dependencias; no se eliminan recursos basándose sólo en cobertura de una navegación. No se encontró una repetición importante de peticiones de catálogo/cesta; el favicon era la repetición menor habitual.
- **Red y datos reales:** la validación complementaria ya incorpora CPU/red limitadas. Sigue pendiente la telemetría de usuarios reales después de una publicación expresamente autorizada. Los milisegundos de respuesta de localhost no demuestran una mejora del servidor de producción.

## Pasos para una publicación posterior

Este trabajo queda sin commit, push ni despliegue. **No necesita migración de esquema, índices, backfill ni cambios de configuración o dependencias.**

1. Revisar y autorizar expresamente la publicación de este conjunto de cambios.
2. Incluir ambas derivadas WebP junto con todos los HTML/JS y cambios de backend. El original permanece disponible. Se pueden regenerar con `node cronox-backend/scripts/optimize-storefront-preloader.cjs`.
3. Ejecutar las comprobaciones indicadas y la compilación habitual: `npm run build --prefix cronox-backend` y `npm run admin:build`. En esta sesión se utilizó `build:compiled` porque el cliente Prisma ya estaba generado y en uso por el servidor local; el esquema no cambia.
4. Publicar frontend y backend conjuntamente y reiniciar el proceso Nest: las plantillas SEO se conservan en memoria durante la vida del proceso. Mantener las versiones nuevas de URL de los scripts y comprobar que la caché/CDN sirve los nuevos HTML y activos.
5. Verificar portada/tienda, imagen inicial y zoom, cesta, presentación de checkout, perfil con ambos diseños y listado administrativo. Confirmar logs y métricas reales sin crear cobros, pedidos ni envíos de prueba en producción.

## Verificación de la primera fase (histórica)

Las compilaciones de backend y administración, ambos typechecks y la ejecución final de la suite general pasan: **252 suites y 2.663 pruebas** (`final-jest-verified.log`). Durante la revisión también pasan los bloques afectados: **147 pruebas en cinco suites** de imágenes/preloader/diseño y **105 pruebas en ocho suites** de perfil/acreditaciones, además del typecheck. Estas cifras son ejecuciones parcialmente solapadas, no deben sumarse como pruebas distintas.

La suite de cesta en Chromium, Firefox y WebKit termina con **120 pruebas correctas y tres omitidas**, de 123 casos configurados. Las omisiones existentes corresponden al gesto táctil que requiere CDP de Chromium y a `isMobile`, no compatible con Firefox. Usa el servidor local de fixtures y API simulada, separadamente de las mediciones con backend real. Verifica los puntos de entrada, persistencia, cantidades, eliminación, contadores/importes, errores/reintentos, cambios de sesión, respuestas tardías, concurrencia y recuperación de navegación.

La suite de acreditaciones termina con **96 pruebas correctas y nueve omisiones previstas**, de 105 casos, en Chromium 320/375/430/escritorio y WebKit iPhone 13. Comprueba libro y METACRILATOS, cinco círculos, identidad/QR, geometría, giros y gestos, pausa de siete segundos con reloj real, ajuste a 1920/2560 px, errores/reintentos y limpieza al salir. Las omisiones corresponden a escenarios exclusivos de escritorio o gestos que requieren CDP; ningún test de navegador necesitó cambiar sus expectativas.

Las capturas comparables y las ocho capturas adicionales de perfil/previews se inspeccionan visualmente; las imágenes grandes se revisan a resolución original cuando la previsualización reducida pierde texto o capas. Los dos QR renderizados de la cuenta real se decodifican correctamente. Al terminar, las cestas anónimas de prueba quedan vacías, la cesta/configuración de la cuenta conservan sus hashes completos, las bases desechables están eliminadas y no queda el archivo temporal de cookies. Los navegadores de prueba y el servidor de fixtures se cierran; el servidor local compilado queda disponible en el puerto 3000.

En el backend local real se comprueban categorías, Todos, drops, selección por teclado, URL directa y recarga; quick add desde categoría filtrada en escritorio y móvil; doble clic con una única petición POST, cierre, talla, aviso de stock, contador e importe; persistencia tras recargar y vaciado de la cesta aislada. Favoritos como invitado conserva la solicitud de sesión. La categoría vacía se prueba con una respuesta inyectada explícita, fuera de las métricas.

La ficha se revisa a 1440×900, 2560×1440 y 2560×1280. Selección de miniaturas/flechas y zoom 2×/4× conservan el estado después de recibir la imagen PDP de 2550 px. En móvil 390×844/DPR 3 se descarga sólo el preloader de 640 px y la foto inicial elige la variante de 1350 px; las flechas funcionan y el zoom por clic sigue desactivado como antes. La prueba explícita de fallo de derivada devuelve 404 sólo para esa URL y comprueba la carga del original real, también al ampliar. No se simulan respuestas en las mediciones formales.

En las capturas asentadas a 2560 px de ancho y escala 100 %, «RECOMENDADOS» permanece visible: a 1440 px de alto ocupa y=1396–1428, y a 1280 px y=1236–1268. La cuadrícula comienza en y=1447,906 y y=1287,906 respectivamente; se conserva la separación de **19,906 px** y la composición anterior. Las hojas de estilo de tienda y producto no tienen cambios. Las capturas comparables se toman tras seis segundos; las de QA temprana no se usan para comparar tiempos de aparición.

Las nueve comprobaciones con PostgreSQL aislado de círculos verifican umbral inclusivo de 85 €, reembolsos, exclusión estadística, fechas persistentes, 30 días completos y concurrencia. Las bases temporales se eliminan al finalizar. Las pruebas del listado verifican ambas direcciones por ID, filtros, páginas vacías/completas, totales y equivalencia de las ordenaciones por métricas.

Las regresiones añadidas cubren riesgos concretos: prioridad y carga diferida de fotos, selección de máxima calidad sin perder zoom, fallback terminal, `srcset` sin anchuras duplicadas, equivalencia de la imagen inicial del servidor, hero sólo en la ruta adecuada, libro/preloader bajo demanda, respuestas tardías tras cambiar usuario o pestaña, contador desde la recepción de datos, ascenso durante la carga y conservación del nodo de texto cuando la cara no cambia.

El verificador existente `verify-ui-media-optimization.cjs` incorpora expresamente las dos derivadas nuevas, sus referencias responsive y metadatos de animación. Conserva las comprobaciones de hashes del original y el rechazo de cambios de imágenes ajenos a su lista. También se actualiza a v6 la referencia de METACRILATOS que el backend inyecta en el preview ORIGINAL.

La suite general comprueba también los contratos existentes de checkout, pagos, idempotencia, reservas, permisos, correo y administración. Esto no equivale a ejecutar integraciones externas reales. No se modifican integraciones de Stripe/Express Checkout, stock, precios, descuentos, webhooks, autenticación, RLS ni activación de envíos.

Limitación de checkout en aquella primera fase (diagnosticada y cubierta con sandbox separado en la ampliación): la API local ya devolvía `shippingMethods: []` para la cesta anónima de prueba, con un artículo y subtotal de 34,95 €. La vista muestra totales como guiones y ninguna opción de envío. Se compara su presentación y acordeón de dirección, sin alterar configuración para fabricar una compra correcta. Aquella fase no validó un pago de extremo a extremo; la ampliación sí completa un pago Stripe TEST real.

Comandos principales de validación: `npm test --prefix cronox-backend -- --runInBand`, `npm run typecheck --prefix cronox-backend`, `npm run build:compiled --prefix cronox-backend`, `npm run admin:typecheck`, `npm run admin:build`, `npm run test:cart:browser`, `npm run test:accreditation:browser` y `node cronox-backend/scripts/test-circle-promotions-db.cjs`. Las comprobaciones de PostgreSQL crean bases desechables; los arneses de medición requieren el arranque local protegido descrito en sus README.

## Validación complementaria antes de publicar — 17 de octubre de 2026

### Condiciones equivalentes y reproducibilidad

- Tres estados independientes: **A** = HEAD original `102a1b9`; **B** = todas las optimizaciones pendientes al comenzar esta validación; **C** = B más correcciones de estabilidad de tienda/cesta. No se revirtió el árbol de trabajo para medir. Los tres backends se compilaron con las mismas dependencias instaladas.
- **90 navegaciones**, tres repeticiones por grupo, orden intercalado/invertido. Tienda/cesta comparan A/B/C en escritorio frío y caliente y móvil frío (54); inicio/producto/checkout comparan A/C en ambos dispositivos fríos (36). Se excluyen calibraciones y observaciones concurrentes con otras pruebas.
- Chromium **155.0.8059.79**, escritorio **2560×1440**, móvil **390×844**, DPR 1. Escritorio representa la referencia de pantalla/escala 100 % indicada; el viewport no resta el marco del navegador. CDP: CPU **4×**, latencia **75 ms**, descarga **10 Mbps**, subida **5 Mbps**, misma máquina y configuración. No equivale a un móvil físico ni al servidor de producción.
- Caché fría: contexto nuevo; caliente: segunda navegación en el mismo contexto. No se purgan cachés de SO, DB ni CDN externos. Consentimiento esencial, newsletter descartada y cesta invitada de una unidad idénticos. Un navegador de medida; sin compilaciones, suites o navegadores de otros agentes durante la ventana.
- Servidores loopback 3011/3012/3013, DB temporal con el mismo catálogo público local de diez productos y sin copiar usuarios/pedidos. Envíos ficticios STANDARD (295 céntimos) / EXPRESS (495 céntimos) en esta DB, igual en todos los estados. API real, activos reales, sin respuestas interceptadas; overrides de origen apuntan a cada servidor aislado. Los POST de pago quedan bloqueados por el perfil de revisión local; esta medición no realiza compras ni certifica el SDK como listo para cobrar. La prueba Stripe TEST se describe separadamente.
- Ventana fija **DOMContentLoaded +8 s** (unos 9 s totales); PerformanceObserver nativo para LCP y CLS máximo de sesión, CDP para red. TTFB documento = responseStart−requestStart; TTFB API = envío → cabeceras. La latencia CDP configurada no convierte estos TTFB locales en latencia de producción: se informa el valor observado y la duración total de petición por separado.
- MB decimales observados: bytes CDP completados más datos parciales recibidos de solicitudes canceladas/pendientes. Los parciales pueden omitir cabeceras. **No son el peso final de toda la página** ni directamente comparables con los MB de transferencias completadas sin throttling de la primera fase. El original del preloader a menudo se cancela antes de descargar sus 4,58 MB; no se cuenta ese tamaño entero como ahorro transferido.

Datos y rangos completos: [measured-summary.md](../output/playwright/performance-validation-20261017/measured-summary.md), [JSON agregado](../output/playwright/performance-validation-20261017/measured-summary.json) y 30 JSON individuales `measured-*.json`. Los scripts `run-all-measurements.ps1`, `measure-template.cjs` y `summarize.cjs` quedan junto a capturas y snapshots. Se conservan candidatos LCP y fuentes de cada layout shift. Los campos auxiliares `reveal` y `content` **no miden contenido visible**: el primero detecta retirada de is-loading/inicio del fade (no el final del overlay #preloader); el segundo, primera imagen de producto completa sin comprobar intersección y sin incluir el hero. No fundamentan la conclusión de velocidad.

### Velocidad, respuesta y estabilidad medidas

Mediana de tres ejecuciones; entre corchetes, mínimo–máximo del LCP. **A → C**; E=2560×1440, M=390×844. Frío salvo las dos filas expresamente con caché.

| Ruta | Vista | LCP ms [mín–máx] | CLS | TTFB documento ms | MB observados | Peticiones |
|---|---|---:|---:|---:|---:|---:|
| Inicio | E | 1024 [972–1048] → 1004 [980–1040] | 0,0000 → 0,0000 | 4,1 → 3,7 | 4,853 → 4,427 | 73 → 73 |
| Inicio | M | 580 [580–584] → 1216 [1196–1224] | 0,0000 → 0,0000 | 3,7 → 3,8 | 3,499 → 3,087 | 69 → 68 |
| Tienda | E | 2056 [1984–2224] → 1940 [1900–2000] | 0,5507 → 0,0000 | 6,4 → 4,9 | 4,746 → 4,190 | 73 → 71 |
| Tienda | M | 1736 [1708–1776] → 1692 [1692–1768] | 1,0365 → 0,0000 | 4,2 → 4,0 | 3,773 → 3,300 | 71 → 69 |
| Producto | E | 3004 [2944–3052] → 2116 [2092–2124] | 0,0007 → 0,0007 | 5,7 → 6,6 | 5,258 → 2,167 | 50 → 48 |
| Producto | M | 2892 [2840–2960] → 700 [632–708] | 0,0000 → 0,0000 | 6,5 → 5,4 | 5,183 → 0,995 | 48 → 46 |
| Cesta | E | 1176 [1172–1196] → 1176 [1160–1192] | 0,0285 → 0,0033 | 2,6 → 2,5 | 0,698 → 0,697 | 39 → 39 |
| Cesta | M | 1168 [1144–1200] → 1196 [1184–1236] | 0,1336 → 0,0025 | 2,4 → 2,5 | 0,698 → 0,697 | 39 → 39 |
| Checkout | E | 1768 [1764–1848] → 1416 [1400–1448] | 0,0159 → 0,0156 | 2,9 → 3,1 | 10,922 → 10,333 | 47 → 50 |
| Checkout | M | 1824 [1752–1852] → 1504 [1408–1584] | 0,0030 → 0,0030 | 2,8 → 2,3 | 10,938 → 10,282 | 47 → 50 |
| Tienda (caché) | E | 1140 [1104–1144] → 1032 [1032–1032] | 0,5508 → 0,0000 | 3,3 → 3,2 | 1,412 → 0,183 | 73 → 70 |
| Cesta (caché) | E | 736 [700–764] → 744 [736–744] | 0,0228 → 0,0033 | 2,2 → 2,1 | 0,135 → 0,136 | 37 → 37 |

- **Mejora clara de producto:** LCP −29,6 % en escritorio y −75,8 % en móvil; los rangos no se solapan. Es la misma fotografía/encuadre. A 2560 px se conserva la misma variante PDP de 1,24 MB, cuya petición pasa de mediana 2.800 a 1.866 ms al evitar descargar también fotos ocultas. En móvil DPR 1 se elige card de 144 KB y su petición pasa de 2.701 a 463 ms. Estos tiempos, además de los bytes, respaldan la mejora.
- **Tienda:** escritorio frío −116 ms y caliente −108 ms; móvil −44 ms con rangos solapados. La corrección principal demostrada es CLS, no una aceleración general de la API. B → C escritorio frío 1.996 → 1.940 ms; caliente 1.016 → 1.032 ms, sin una regresión sostenida demostrada por estas tres muestras.
- **Inicio escritorio prácticamente estable:** mismo hero,1.024 → 1.004 ms, rangos solapados. **Regresión del indicador LCP móvil: 580 → 1.216 ms.** A mide logo superior (4.692 px²); C mide preloader (20.736 px²), porque la derivada termina y el original se aborta 3/3. El mismo logo superior mantiene 580 ms de mediana en ambos. Es un aumento real del indicador, pero no prueba 636 ms adicionales de espera del contenido principal. Se conserva el preloader y su diseño; no se oculta para bajar la métrica.
- **Cesta:** escritorio frío idéntico; caliente +8 ms; móvil +28 ms, con rangos solapados. Se registran estas pequeñas regresiones observadas sin atribuir una causa sostenida. CLS baja claramente. TTFB documento sigue en pocos milisegundos; no hay mejora general demostrada. Producto E sube 5,7 → 6,6 ms y una muestra móvil final llega 17,2ms: no se eliminan del resultado.
- **Checkout:** baja el LCP medido, pero cambia de logo del banner a preloader; no demuestra pago listo antes. En cada una de sus 12 navegaciones quedan 8 requests sin evento CDP de finalización al corte, incluidos documentos internos de Stripe y el mismo PNG original grande del resumen. En escritorio la imagen sigue incompleta; no se etiqueta como 404 ni imagen permanentemente rota. Este comportamiento existe en A y C y deja **incompleta la medición de carga total/bytes finales del checkout**. Tampoco se oculta el aumento de 47 → 50 peticiones. La nueva DB con envíos permite cargar partes ausentes en la primera fase: no comparar estos10 MB parciales con los 1,45 MB históricos.
- Los90 documentos devuelven 200, sin pageerror Chromium ni overflow horizontal observado. Los únicos HTTP≥400 son 401 esperados de invitado en me/favorites. Las cancelaciones del preloader antiguo/presencia y el tráfico aún pendiente quedan registrados; no se interpretan como peticiones exitosas completas.

Peticiones principales, frío, mismas navegaciones (medianas ms). La duración incluye espera/descarga observada; TTFB no es tiempo interno exclusivo del servicio.

| Petición / vista | TTFB A → C | Duración A → C |
|---|---:|---:|
| Catálogo / tienda E | 11,74 → 8,84 | 274,39 → 179,28 |
| Catálogo / tienda M | 9,12 → 9,36 | 278,62 → 211,00 |
| Categorías / tienda E | 5,03 → 29,36 | 101,75 → 99,47 |
| Cesta / cesta E | 27,24 → 4,15 | 106,83 → 100,18 |
| Cesta / cesta M | 4,42 → 4,13 | 100,05 → 104,58 |
| Recomendaciones / cesta M | 7,33 → 26,44 | 162,35 → 177,11 |
| Resumen checkout E | 4,59 → 5,40 | 109,82 → 100,67 |
| Resumen checkout M | 4,36 → 4,53 | 115,01 → 100,22 |

Hay variación en ambas direcciones: categorías E 5,03 → 29,36 ms de TTFB sin empeorar su duración total, y recomendaciones de cesta M 7,33 → 26,44 ms con duración 162,35 → 177,11 ms. Esas rutas de backend no se modificaron; tres muestras no aíslan la causa ni demuestran una regresión de servidor. Se conserva la observación. No se dispara un benchmark adicional de carga contra producción. En checkout, la descarga del preloader sí se reduce de 7.643 a 1.185 ms en escritorio; es una petición concreta completada, distinta del LCP y de la disponibilidad del formulario.

### Saltos: causas, correcciones y diseño conservado

Separación causal por los tres estados; medianas de frío del experimento anterior:

| Ruta / vista | A original | B optimización inicial | C final |
|---|---:|---:|---:|
| Tienda / E | 0,550704 | 0,576094 | 0,000000 |
| Tienda / M | 1,036524 | 1,189836 | 0,000000 |
| Cesta / E | 0,028532 | 0,028532 | 0,003264 |
| Cesta / M | 0,133576 | 0,133576 | 0,002469 |

1. **Tienda:** los enlaces iniciales de catálogo ocupaban poco; el montaje de categorías aplicaba un catálogo aún vacío; al llegar las tarjetas desplazaban galería/footer. La optimización inicial no corrigió la causa y alteró el momento de los saltos (B móvil tiene mediana mayor, dentro del rango observado también en A). Ahora /tienda sin filtros presenta los mismos enlaces reales con el marco y fila informativa de la tarjeta existente; el evento de categorías espera la petición inicial. No añade productos ni precios inventados, no anticipa imágenes extra y conserva vacío/error/reintento. El ajuste SSR no se extrapola a consultas filtradas sin datos equivalentes.
2. **Cesta:** insertar las opciones de envío después del primer render aumentaba el resumen 104 px; el mensaje inicial en flujo desplazaba el grid 42 px. Se sirven las mismas opciones/precios en HTML, se conserva una selección hecha antes del JS y el mensaje permanece visible dentro del área vacía de artículos. El override sólo durante carga inicial anula también 8 px de padding superior e inferior del CSS compartido. Error y actualización con datos mantienen su flujo. No se oculta contenido.
3. **Residuo:** a 2560 px queda CLS 0,003264 (0,002469 móvil) al llegar recomendaciones/importes. En diagnóstico 1440×900 baja 0,124246 → 0,005158. No se reserva una cantidad arbitraria de tarjetas ni se altera el bloque de recomendados para forzar cero.

Comparación antes/final en 1440×900 y 390×844: **67 elementos de tienda y 34 de cesta por viewport, cero diferencias** de geometría final, tipografía, separación, encuadre/transformaciones y fuente de imagen. Carga retenida comprobada a 320×568,390×600 y 1440×900: mensaje visible sin solapar resumen ni provocar scroll horizontal. Error400 explícitamente simulado para comprobar reintento; recuperación mediante GET real. Esta prueba de error no forma parte del benchmark.

Cambios adicionales limitados a `public-seo.ts`, `products.js`, HTML/JS/CSS de cesta, pruebas focales y referencias de versión: `app` 96, `products` 74, `cart.js` 9 / `cart.css` 7. La elección de dos tarifas estáticas ya existía: no se ha resuelto ni ampliado el problema previo UX-02 de tarifas de cesta. Las fuentes de producto, zoom, perfil y acreditaciones mantienen sus hashes previos. [Diagnóstico, capturas y geometrías](../output/playwright/performance-validation-20261017/layout/README.md).

### Checkout: diagnóstico y pago TEST de extremo a extremo

**Causa de shippingMethods vacío:** lectura de cronox_dev confirma cero filas en ShippingMethod; no es un fallo introducido por la optimización. Esa base queda intacta. La base antigua de sandbox tenía envíos, pero carecía de CircleReconciliationQueue y metadatos de migraciones; no se migró ni reutilizó.

La configuración TEST existente proporcionó acceso operativo. El runner previsto `checkout-sandbox.cjs` activa CRONOX_STRIPE_SANDBOX, pero el guard de revisión no consume ese indicador y sigue bloqueando POST con CRONOX_LOCAL_DEV=true. Se ejercitó el backend real mediante **adaptador local privado**, que verifica una base nueva exacta en 127.0.0.1:5433, claves TEST y salida de red restringida a loopback/api.stripe.com antes de usar el perfil CRONOX_LOCAL_DEV=false. No se relajó el guard del proyecto ni se cambiaron sus .env. Correo, Correos y tareas externas desactivados. Esto valida el flujo aislado, **no certifica que el runner original funcione sin esa preparación**.

Frontend apunta explícitamente a 3006 y sustituye sólo el asset runtime-config por pk_test; la autodetección original apuntaba3000 y el asset de despliegue contiene la clave pública del sitio. No se simulan respuestas de catálogo/cesta/checkout/Stripe/webhook. La DB nueva contiene sólo productos ficticios, stock 40, dos envíos y promoción 10 %. Stripe CLI → receptor 3007 verifica firma y pertenencia a esta base antes de reenviar cuerpo/firma originales al webhook 3006; no procesa eventos de otros usuarios del sandbox.

| Paso | Resultado real de sandbox |
|---|---|
| Producto 10 € + estándar 2,95 € | Total 12,95 €; ambos métodos visibles |
| VALIDATION10 | Descuento 1 €; total11,95 € |
| Cambio a exprés 4,95 € | Total 13,95 €; intento previo cancelado, webhook original 200 y reserva liberada |
| Tarjeta TEST declinada | Stripe 402 y mensaje visible; webhook payment_failed200 |
| Corregir tarjeta/reintentar | Mismo intento de 13,95 €; dos activaciones DOM inmediatas del botón real producen un único POST confirm; queda deshabilitado tras la primera |
| Éxito | Stripe `livemode=false`, `succeeded`, 1.395 céntimos EUR; webhook original firmado 200/PROCESSED; un pedido PAID, una reserva CONSUMED |
| Stock y descuento | 40 → 39; movimiento neto−1; cero reservas activas; promoción usada una vez |
| Recarga y reentregas | Pedido persiste; dos replays verificados 200/duplicate=true, estado DB idéntico |

Los replays usan el evento real recuperado de Stripe, con firma TEST generada localmente; se distinguen del webhook original entregado por Stripe CLI. Hubo un tercer POST previo cuyo arnés falló al leer response.status como función; se conservó evidencia y se corrigió sólo el arnés. No hubo consumo adicional. El primer intento de doble clic de puntero no se pudo atribuir al botón por cambios del iframe: **no se cuenta como doble clic físico aprobado**; la prueba válida es la doble activación DOM y su único POST.

Payment Element/Stripe real, PayPal exprés, selector PayPal y presentación de transferencia cargaron. No se certifica pago completo de PayPal, Bizum, Klarna, Revolut/Amazon Pay, EPS, Bancontact ni transferencia. Apple/Google Pay requieren HTTPS, dominio registrado y dispositivo/cuenta compatibles, ausentes en este ensayo. La disponibilidad TEST no certifica activación LIVE. No se enviaron comunicaciones a clientes ni se efectuaron cobros LIVE o cambios de producción. [Evidencia y limitaciones de checkout](../output/playwright/performance-validation-20261017/checkout/checkout-validation.md).

### Regresiones, pruebas pertinentes y conservación

- **76 pruebas / 5 suites focales pasan** para SEO, catálogo/categorías, carga y controles de envío de cesta. Compilación de los snapshots y build:compiled final del backend correctos. No se repitió indiscriminadamente la suite general: las 2.663 pruebas citadas arriba pertenecen a la primera fase.
- Cesta con API simulada: **11/12 casos completos pasan**; el restante cumple cantidades/persistencia pero falla el recolector pageerror de WebKit. Repetición focal 2/3 completos,3/3 aserciones funcionales. HEAD 3/3 completos en ese caso. **No se declara toda la suite verde.**
- La comprobación WebKit con API real aislada, sin interceptar, conserva una unidad/34,95 € en 3/3 ciclos atrás/adelante/recarga; reproduce un diagnóstico de presencia 18 ms después de navegar, con **cero window.error y cero unhandledrejection**. Playwright transforma errores JavaScript de consola WebKit en pageerror. El flujo de presencia aborta su controlador al salir; sus peticiones y la obtención de CSRF están dentro de try/catch. Los diagnósticos coinciden con la navegación, sin aislar su causa exacta. Sus scripts/servicios no cambiaron. Clasificación: diagnóstico intermitente de transporte durante navegación; causalidad con optimización abierta, **sin pérdida de cesta ni excepción no gestionada demostrada**. No se silenció código ni tests para obtener verde.
- API/BD reales del sandbox, Chromium 1440×900 y 390×844: quick-add desde RECOMENDADOS, dos activaciones → un POST/una unidad, cierre tras éxito, persistencia al navegar/recargar y subtotal 12 €. Cestas propias vaciadas. Mocks cubren además fallo con popup abierto y reintento.
- Zoom real: escritorio2×/4×, salida, miniatura/flechas; móvil conserva desactivación de zoom por clic y flechas operativas. Esta pasada usa PNG locales sin derivadas; las variantes PDP/fallback están cubiertas en la evidencia inicial y sus fuentes no cambiaron.
- Acreditaciones: **28 pasan, 5 omisiones previstas, 0 fallos** en 33 casos focales Chromium/WebKit, libro/META, cinco círculos, identidad/QR, gestos, pausa/reanudación y resize hasta 2560×1440. Datos/API y mayor parte del reloj simulados; no es una nueva lectura de configuración de producción ni certificación visual de cada arte subido. No se guardó ni activó ningún diseño.

[Detalles y trazas de regresión](../output/playwright/performance-validation-20261017/regression/README.md). La revisión de integridad conserva los 54 archivos pendientes iniciales y sus copias con hash; sólo se añaden los cambios de tienda/cesta, versiones y pruebas descritos. Los documentos de auditoría previos permanecen intactos. [Revisión de conservación](../output/playwright/performance-validation-20261017/regression/preservation-README.md).

### Estado para publicación

No se ha identificado una **regresión funcional confirmada causada por esta optimización** en los recorridos comprobados. Se conserva una regresión numérica de LCP móvil de inicio por cambio de candidato, pequeñas variaciones de tiempos de cesta/API y el diagnóstico WebKit cuya atribución sigue abierta. Por ello **no se presenta una validación completamente verde ni una mejora universal de velocidad**. El CLS residual de cesta es pequeño y queda medido; no se alteró el diseño para eliminarlo.

El pago de tarjeta TEST, pedido, webhook y consumo único de stock están verificados; **no falta acceso para ese recorrido**. Los bloqueos concretos del entorno habitual son datos de envío ausentes y runner/configuración local de sandbox incompatibles, resueltos sólo dentro del adaptador desechable de esta prueba. Wallets requieren los accesos/entorno señalados. La medición completa de carga del checkout queda limitada por su imagen grande preexistente y la ventana fija. Estas limitaciones no son regresiones nuevas confirmadas del trabajo de rendimiento.

La auditoría anterior conserva por separado los riesgos SEC-01 (reclamación de ciertas cuentas sin prueba de correo), COM-01 (compensación tras fallo posterior al commit) y COM-02 (webhook PROCESSING sin recuperación durable), además de UX-02. **Esta validación no cierra esos hallazgos ni autoriza publicar el conjunto como seguro**; son problemas anteriores que deben valorarse independientemente. Véase [auditoría existente](audit-cronox-2026-10-17.md).

Todo queda **local, sin commit, push ni despliegue**. No requiere nuevas dependencias ni migraciones de producción. Se retiraron los procesos, bases temporales y copias privadas de credenciales de esta validación; quedan los artefactos de evidencia ignorados por Git y el servidor local habitual con las fuentes compiladas finales. Las configuraciones originales no fueron editadas; checkout registra hashes iguales antes/después de su limpieza, sin afirmar una comparación retroactiva con un hash inicial inexistente.
