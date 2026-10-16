Quiero que implementes en el repositorio CRONOX dos funcionalidades completas y conectadas: el nuevo diseño de acreditación «METACRILATOS» y el apartado de administración «Eventos QR».

Trabaja hasta dejar la implementación funcional y verificada en local. No te limites a darme un plan. Conserva los cambios ajenos existentes. No hagas commit, push, despliegue, cambios en producción ni migraciones contra una base de producción. Deja preparados el código y las migraciones necesarias para su publicación posterior.

1. INSPECCIÓN E INTEGRACIÓN CON LO EXISTENTE

Lee AGENTS.md y las instrucciones aplicables. Inspecciona primero la arquitectura real, el sistema de acreditaciones, el selector de diseño activo, sus vistas previas, los datos del perfil, el cálculo de círculos, el administrador, los permisos y las migraciones. Como orientación, CRONOX utiliza frontend HTML/CSS/JS y backend NestJS/Prisma; comprueba las versiones y convenciones del repositorio antes de trabajar.

Reutiliza el sistema existente. Evita una segunda implementación paralela de acreditaciones, usuarios, permisos o QR si ya existe una que cumple los requisitos. Identifica los archivos y el flujo que vas a ampliar y continúa con la implementación. Resuelve las decisiones rutinarias siguiendo el proyecto; pregunta solo si falta un dato imprescindible que no puedas obtener del código o de las referencias adjuntas.

2. DISEÑOS APROBADOS: FUENTE DE VERDAD

La carpeta adjunta «metacrilatos-codex/disenos» contiene los cinco diseños definitivos:

- circulo-1.html: círculo I, negro, un círculo dibujado.
- circulo-2.html: círculo II, negro, dos círculos dibujados y borde superior negro puro.
- circulo-3.html: círculo III, degradado gris, tres círculos dibujados, dos líneas de contorno separadas, sin banda rellena.
- circulo-4.html: círculo IV, blanco perla, cuatro círculos dibujados. Su acabado concreto y su banda blanca exterior están aprobados: consérvalos tal cual.
- circulo-5.html: círculo V, burdeos, cinco círculos dibujados y su contorno original.

Comprueba MANIFEST.json para identificar las referencias exactas. Estos HTML contienen datos y QR de demostración: son la referencia visual y de comportamiento, no una conexión a datos reales. Si no encuentras esta carpeta, localízala entre los archivos adjuntos antes de reconstruir nada; si no está disponible, solicita los archivos que faltan.

Integra sus diseños fielmente. Conserva geometría, tamaños, proporciones, tipografías, posiciones, recortes de los logos oficiales, colores por círculo, anverso/reverso, esquinas cerradas, volumen, cantos y reflejos interactivos. Mantén arrastre, giro manual y automático y reducción de movimiento. No rediseñes ni unifiques detalles que difieren entre versiones aprobadas. Puedes compartir código y extraer los activos repetidos siempre que el resultado de cada variante siga siendo el mismo.

En particular, I–III mantienen las dos líneas separadas del contorno de la tarjeta interior; no rellenes el espacio entre ellas. IV mantiene su versión blanca aprobada. V permanece exactamente como su referencia. El logo largo y el número romano central deben compartir exactamente el mismo color en cada variante; el símbolo pequeño de la etiqueta debe compartir el color de su texto.

Retira únicamente el contenedor externo de presentación y los textos demostrativos, como «CONCEPTO» y los datos de ejemplo; integra la acreditación en el espacio real que le corresponde. Esto nunca se refiere a la carcasa de metacrilato, sus cantos ni los marcos y contornos de la tarjeta: deben conservarse. Conserva los controles de giro necesarios y su funcionamiento. No cambies el diseño de la tarjeta para adaptarlo al contenedor: escálalo proporcionalmente cuando sea necesario.

3. UNA SOLA OPCIÓN EN ADMIN: «METACRILATOS»

Añade exactamente una nueva opción llamada «METACRILATOS» dentro del apartado existente de Acreditaciones, con su vista previa y los controles de selección/activación que ya tenga el sistema.

Esta opción contiene las cinco variantes y elige automáticamente la correspondiente al círculo real del cliente. No deben aparecer como cinco diseños independientes que haya que asignar a mano. No cambies las reglas que determinan el círculo. Un círculo ausente o inválido debe tratarse con el estado correspondiente del sistema; no conviertas silenciosamente un valor desconocido en I o V.

La acreditación actualmente subida y su selección activa deben permanecer intactas. Registrar la nueva opción no la activa automáticamente. La activación de METACRILATOS se hará mediante la acción explícita existente del administrador. Abrir, cerrar o recargar una vista previa no debe cambiar el diseño activo, guardar configuración, borrar su URL ni modificar la versión anterior. Respeta el alcance global o por círculo que ya tenga el selector.

4. PERSONALIZACIÓN REAL DEL CLIENTE

Sustituye todos los datos de demostración por los datos reales y autorizados del usuario mostrado:

- Círculo: variante correspondiente, romano correcto y exactamente ese número de círculos dibujados detrás del romano.
- Nombre: toma el campo real de nombre del perfil. Normaliza espacios al principio/final y espacios repetidos y muestra, como máximo, sus dos primeras palabras. «Daniel Rivas Cruz» debe quedar «Daniel Rivas»; «Daniel» debe quedar «Daniel»; null, undefined, cadena vacía o solo espacios deben dar un campo completamente vacío. No completes un nombre ausente con email, ID, nombre de ejemplo o «Usuario». No añadas palabras de otros campos como sustitución de un nombre vacío. Si el modelo separa nombre/apellidos, documenta el mapeo real y respeta esta regla sobre el nombre, sin inventar una concatenación.
- Fecha inferior: fecha real de registro original del cliente, en DD/MM/AAAA y zona Europe/Madrid. Utiliza el campo autoritativo existente; no updatedAt, fecha de creación del QR ni fecha actual. Valida fechas ausentes/incorrectas y evita mostrar «Invalid Date» o inventar una fecha.
- ID de la etiqueta trasera: identificador estable y publicable del usuario que corresponda según el modelo real. No uses el «N.º» de listado administrativo si se recalcula al borrar clientes. No dejes CRX-000001 ni inventes formatos sin comprobar los datos.
- QR: QR real, personal y persistente de esa acreditación, según el contrato del siguiente apartado.

El nombre vacío debe conservar su hueco: no desplaces la fecha ni el resto. Los datos deben renderizarse como texto, sin inyección HTML. Comprueba nombres largos e IDs reales: deben ser legibles y no quedar cortados por overflow. Si hace falta, limita el ajuste al tamaño del texto de ese campo, manteniendo la composición y el tamaño normal de las referencias para los casos habituales.

El cliente solo puede obtener su propia acreditación desde sus endpoints; el administrador puede consultar las vistas previas según los permisos existentes. Usa el estado autoritativo del backend, no valores de círculo/ID enviados por el navegador. Evita que una respuesta tardía de otro usuario o círculo deje su QR o nombre en la tarjeta actual.

5. IDENTIDAD Y GENERACIÓN DEL QR

Cada usuario debe disponer de un identificador QR/acreditación único, estable y persistente. Reutiliza el existente si es adecuado; si no existe, añade el mínimo modelo necesario, con unicidad en base de datos y generación segura en servidor.

Distingue el ID interno del usuario, su ID visible y el identificador QR. El QR debe resolver inequívocamente al usuario mediante el servidor, sin depender de números de lista recalculables. Su contenido debe ser opaco y no predecible, con formato/versionado reconocible. No metas datos personales, contraseñas ni tokens de sesión en el QR. No conviertas el QR en un inicio de sesión ni en una autorización del usuario.

El mismo usuario conserva su identificador QR al recargar, cambiar de dispositivo, cambiar de nombre, subir/bajar de círculo o cambiar de diseño. No generes un identificador nuevo cada vez que se renderice. Prepara una provisión/backfill idempotente para usuarios existentes y generación para nuevos usuarios, acorde con el modelo real. Las vistas previas de datos ficticios no deben generar credenciales reales ni altas en eventos.

Genera localmente el gráfico QR a partir del contenido real usando dependencias apropiadas del proyecto; no envíes identificadores a un servicio externo de generación. El QR a www.cronox.es de las referencias es solo una muestra y debe desaparecer de las acreditaciones reales. Si reutilizas un formato URL existente, valida su origen/ruta de forma estricta y resuélvelo internamente; no abras ni solicites URLs arbitrarias obtenidas al escanear.

Conserva el espacio cuadrado del QR y el margen libre completo, con contraste suficiente para escanearlo. Mantén los reflejos por debajo de la capa opaca del QR, como en las referencias. Ajusta la densidad y corrección de errores a la longitud real del contenido y verifica lectura en el tamaño móvil real, no solo desde la imagen QR original grande. Conserva los colores aprobados: resuelve primero cualquier problema de lectura mediante longitud del contenido, corrección de errores y calidad de renderizado. Si persistiera un impedimento que exigiera cambiar el diseño, documenta el problema y presenta el cambio concreto para aprobación antes de aplicarlo.

6. NUEVO APARTADO «EVENTOS QR»

Añade un apartado visible llamado «Eventos QR» en el administrador, integrado en su menú, rutas, estilo y permisos. Colócalo en la agrupación de Clientes si encaja con la organización actual.

Debe permitir crear distintos grupos/eventos con nombre obligatorio y descripción opcional, listarlos con su total de usuarios registrados y abrir cualquiera de ellos. Reutiliza los patrones de carga, búsqueda, paginación y errores del administrador cuando hagan falta. Los grupos y sus participantes se guardan en la base de datos y se conservan al recargar, cerrar sesión y abrir desde otro dispositivo autorizado.

Dentro de cada grupo, muestra claramente el nombre del grupo activo, su total, el botón «Abrir cámara», la opción de detener el escaneo y la tabla de usuarios registrados. La tabla debe incluir, como mínimo, ID estable del usuario, identificador QR publicable, nombre, círculo al registrarse y fecha/hora del primer registro. Guarda también qué administrador realizó el registro. Muestra las horas en Europe/Madrid y conserva los instantes en el formato temporal consistente del backend.

Flujo principal: abro un grupo, abro la cámara y escaneo una acreditación; el servidor identifica al usuario y lo añade directamente a ese grupo. No debe pedirme buscarlo ni confirmar manualmente cada lectura válida. Actualiza la fila y el total tras confirmar el guardado y permite seguir con el siguiente QR.

7. ESCANEO, DUPLICADOS Y ESTADOS

El navegador envía el contenido del QR y el grupo seleccionado. El backend valida el formato, los permisos, el grupo y la acreditación y resuelve al usuario. No confíes en un userId declarado por el navegador para atribuir el registro.

Regla de negocio: un usuario tiene una sola inscripción en cada grupo. Impón unicidad real en base de datos sobre (groupId, userId) o su equivalente y una operación atómica que resuelva también conflictos de concurrencia. No basta con comprobar antes si existe.

Un QR leído varias veces, una respuesta perdida seguida de reintento o dos administradores escaneando simultáneamente deben dejar una sola fila y conservar la fecha/autor del primer registro. El resultado repetido será «Ya registrado en este grupo», no un error 500 ni una fila adicional. Ese mismo usuario sí puede registrarse una vez en cada uno de otros grupos.

Evita enviar una petición por cada fotograma del mismo QR. Controla las lecturas en curso y aplica una supresión temporal por QR/grupo sin impedir escanear rápidamente personas distintas. El grupo de cada petición queda fijado al iniciar esa lectura; cambiar de grupo no puede registrar ni mostrar el resultado en otro grupo por accidente. Detén el lector y limpia su estado al cambiar de grupo.

Estados visibles y diferenciados: registrado, ya registrado, QR no válido/desconocido, credencial no utilizable según las reglas existentes, grupo no disponible, permiso insuficiente y fallo de red/servidor. Un código ajeno no crea usuarios ni registros. No muestres «Registrado» ni incrementes el total hasta que el backend confirme el guardado. Si se pierde la respuesta, permite reconciliar/reintentar de forma idempotente y no asegures que no se guardó si el resultado es desconocido.

8. CÁMARA Y COMPATIBILIDAD

La cámara se abre por acción explícita del administrador. Prefiere la trasera en móvil, permite cambiar de cámara cuando haya varias y no solicites micrófono. Implementa manejo visible de permiso denegado, permiso pendiente, ausencia de cámara, cámara ocupada y contexto no seguro, con recuperación apropiada.

Trabaja en HTTPS o contexto local seguro. Detecta las capacidades reales: no dependas exclusivamente de BarcodeDetector. Si no está disponible o no admite QR, usa un lector compatible, mantenido y empaquetado con el proyecto. Verifica Chrome/Android, Safari/iPhone y escritorio en la medida que permita el entorno; distingue pruebas físicas de simuladas. No actualices el stack completo para añadir el lector.

Al detener el escaneo, salir del grupo, cambiar de sección o cerrar sesión, cancela el bucle de lectura y libera todos los tracks de cámara. No almacenes ni subas imágenes/vídeo de la cámara. No dejes permisos o streams abiertos innecesariamente ni un overlay bloqueado si el usuario no responde al permiso.

9. BACKEND, PERSISTENCIA Y CICLO DE VIDA

Protege todas las rutas de grupos, listados, participantes y escaneo con autorización real del servidor y las convenciones de ADMIN/SUPERADMIN del proyecto. Ocultar el menú no es suficiente. Aplica validación de entradas, límites razonables, protecciones de sesión/CSRF que correspondan y gestión segura de errores. No expongas secretos ni credenciales completas en logs.

Añade migraciones compatibles y aditivas, claves foráneas, restricciones únicas e índices necesarios. Evita borrar datos, cambiar IDs existentes o provocar pérdidas accidentales de historial mediante cascadas. Respeta el flujo existente de eliminación/anonimización de usuarios y su política de datos; no introduzcas bloqueos inesperados de ese flujo ni retengas información que la política exige eliminar. Asegura que ninguna inicialización o seed duplique METACRILATOS, grupos o credenciales al repetirse. Comprueba que las operaciones se ejecutan contra una base local/de pruebas autorizada antes de aplicarlas.

Adapta el componente 3D a múltiples instancias: IDs de filtros SVG únicos, inicialización por raíz, actualización de datos sin duplicar anillos, cancelación de animaciones, desconexión del ResizeObserver y eliminación de listeners al desmontar. Conserva la geometría de los 68 paneles del canto y las fórmulas de los reflejos. Evita propiedades en ancestros que aplanen el 3D. Mantén la compatibilidad con las políticas CSP y la gestión de activos del proyecto.

10. VERIFICACIÓN Y ENTREGA

Ejecuta compilación, comprobaciones estáticas y las pruebas relevantes. Añade pruebas de integración para la persistencia, autorización e idempotencia; no sustituyas la prueba de concurrencia real de la base de datos por un mock que siempre responda bien.

Comprueba y documenta, al menos:

- Los cinco círculos coinciden con sus referencias en ambas caras, tamaños móvil/escritorio y giro; romano y número de anillos correctos. Conserva especialmente los diferentes contornos aprobados de IV y de I–III/V.
- Nombre de una, dos y más palabras; espacios repetidos; null/vacío; nombres largos; fecha original; ID real completo; ausencia de datos demo y de filtraciones entre usuarios.
- El mismo usuario conserva el QR tras recargar o cambiar de círculo/nombre; dos usuarios distintos tienen QR distintos.
- Activar METACRILATOS mediante el mecanismo existente funciona en local; abrir su preview no altera la selección ni el diseño anterior. Deja al terminar la selección activa original tal como estaba, salvo instrucción explícita distinta.
- Crear un grupo, escanear una acreditación, ver su fila y recargar mantiene datos y total. El mismo QR en otro grupo registra allí al usuario.
- Repetición y concurrencia desde dos clientes producen exactamente una fila por usuario/grupo, incluso si se pierde una respuesta y se reintenta.
- QRs ajenos, malformados, inexistentes y sesiones sin permisos no crean registros ni revelan datos privados. Fallos de red no producen falsos éxitos.
- Permisos de cámara, parada/reapertura, cambio de cámara/grupo, salida de la sección, y lectura con los QR reales en los tamaños presentados.
- Las acreditaciones existentes y las funciones ajenas a este trabajo conservan su comportamiento.

Entrega un resumen de archivos modificados, migraciones preparadas, decisiones sobre ID/QR y nombre, pruebas ejecutadas y resultados. Explica dónde se encuentran METACRILATOS y Eventos QR y cómo probar el flujo completo. Señala claramente cualquier validación física o condición que no hayas podido comprobar y da pasos concretos para revisarla. No declares «sin errores» ni «probado en iPhone» sin evidencia real.

Completa las correcciones que detectes dentro de este alcance. El resultado debe quedar integrado y utilizable en local, con los diseños aprobados preservados y sin publicar ni activar cambios en producción.
