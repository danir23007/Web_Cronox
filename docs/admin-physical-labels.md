# COBRO FÍSICO → Etiquetas

Estado: adaptación local a 62 × 35 mm, 22/11/2026. Sin publicar. Este formato sustituye al anterior de 50 × 35 mm en el flujo automático.

## Formato vigente y controlador

Brother QL-700 USB, rollo continuo blanco de 62 mm. Una etiqueta por página física de **62 mm de ancho × 35 mm de avance/corte**, horizontal. En Windows seleccionar **PRUEBA 1**, ya creado y probado por el usuario, con **Alimentar: 3 mm**, escala 100 % / tamaño real, sin ajustar a página ni cabeceras o pies. La web no selecciona la impresora, controla el corte ni confirma una impresión física.

Brother documenta 696 puntos / **58,93 mm imprimibles** para este rollo ([referencia raster, página 6](https://download.brother.com/welcome/docp000678/cv_qlseries_eng_raster_600.pdf)). La aplicación reserva conservadoramente **58,9 mm**, con 1,55 mm a cada lado. Mantiene 3 mm interiores en cada extremo, dentro de los 35 mm del papel. Estos offsets protegen el área útil: no se suman al tamaño del documento ni se añaden otros 3 mm por «Alimentar». El HTML declara `@page{size:62mm 35mm;margin:0}` y PDFKit crea páginas exactas de 62 × 35 mm.

## Diseño automático

```text
CRONOX: NOMBRE DEL PRODUCTO
COLOUR: COLOR
SIZE: TALLA
[código Code 128 real]
[identificador persistente]
```

Todos los textos están en mayúsculas. Solo CRONOX y los dos puntos van en negrita (7 pt); nombre, color y talla usan 6,5 pt sin negrita y alineados a la izquierda. Los nombres largos aprovechan el ancho útil adicional, con una línea limitada y elipsis; su texto completo se conserva como título del SVG.

El código mantiene su tamaño físico, sin estirarse: **46,8 × 10 mm**, módulo de 0,3 mm y once módulos de silencio a cada lado. Queda centrado en el ancho útil de la etiqueta; el identificador de 6 pt se centra exactamente respecto al símbolo, en x = 31 mm de la página.

La separación entre SIZE y el código aumenta de 0,8 a **1,8 mm** entre sus cajas de composición. Las tres líneas superiores suben 1 mm; las posiciones verticales del código y del identificador son idénticas a las del diseño anterior. Se conservan las demás separaciones y el margen inferior. Ningún elemento se recorta ni se superpone.

`label-composition.ts` genera el mismo SVG para vista previa, impresión y PDF vectorial. El perfil activo es `brother-ql700-continuous62`. El servidor siempre genera este diseño automático nuevo; rechaza medidas o plantillas enviadas por el navegador. Las configuraciones históricas de 50 mm y la tabla `LabelTemplateSettings` se conservan, pero no se consultan para imprimir etiquetas. No hay migración SQL nueva.

## Colocación sobre el cartón

Cartón negro de **55 × 105 mm**, vertical. Solo en la vista contextual, la pegatina completa gira **90° antihorarios**: ocupa **35 × 62 mm** y deja **10 mm negros por lado**. La referencia se centra verticalmente para valorar proporción; agujero y web no tienen posiciones inventadas. La colocación final será manual, dejando ambos visibles. El cartón no aparece en PDF ni se imprime.

## Acceso y flujo

Entrar como ADMIN o SUPERADMIN a `/admin.html#section-labels`, o **COBRO FÍSICO → Etiquetas**. Se conservan JWT, permisos administrativos, CSRF y respuestas sin caché.

Los productos aparecen plegados y muestran imagen, nombre, color, estado y resumen de tallas/cantidades. Se pueden abrir varios. Plegar, filtrar o paginar conserva selección y cantidades durante la sesión de pantalla. Se muestran también tallas sin stock e inactivas.

1. Desplegar productos y seleccionar tallas y cantidades.
2. Pulsar Ver etiquetas, Imprimir selección, Imprimir etiqueta de prueba o Descargar PDF. La prueba prepara una sola copia de la primera talla sin alterar la selección.
3. Si faltan códigos, se muestra un aviso junto a los botones y **Generar códigos ausentes y continuar**. Solo esa pulsación explícita genera los ausentes y reanuda la acción original. Los existentes se reutilizan exactamente.
4. El estado «Preparando…», los errores y las alternativas quedan visibles junto a los controles. Se espera la carga del documento y sus fuentes antes de imprimir, con tiempos máximos para sesión, red y documento. Los controles se liberan antes de invocar print.
5. Si el diálogo no aparece, usar **Abrir documento para imprimir** y después Imprimir / Ctrl+P, o los enlaces **Abrir PDF preparado** / **Descargar PDF preparado**. Las URLs Blob duran mientras el documento siga vigente y se liberan al cambiar selección, preparar otro documento o abandonar la página.

La respuesta PDF se valida mediante Content-Type, tamaño y cabecera `%PDF-`. No se declara una impresión completada ni una descarga completada por abrir un diálogo o disparar un enlace.

El catálogo actual guarda los colores en el nombre; no hay campos estructurados en Product/ProductVariant. Se extraen solo sufijos reconocidos precedidos de ` - ` y se normalizan colores conocidos al inglés. CORE TEE se presenta como CORE-TEE. Si no hay un color reconocido, se imprime COLOUR: - y se permite preparar, descargar e imprimir la etiqueta. El nombre original no se recorta para inventar un color. No se modifica el catálogo para conseguir esta presentación.

Límites: 200 variantes, 500 etiquetas por variante y 2000 por solicitud. Los identificadores siguen ligados a ProductVariant.id, con unicidad e identidad inmutable, independientes de nombre, precio, stock y tiradas. Se conserva la resolución futura para caja. No se implementan ventas ni reservas de stock.

## Comprobaciones por software

- **55 pruebas Jest**: composición, permisos, límites, recuperación del flujo, plegado y cantidades, errores, colores y conservación de datos históricos. La comparación con el diseño anterior confirma exactamente +1 mm antes del código, barras e identificador en la misma posición vertical, fuentes iguales y dimensiones de 62 × 35 mm. La plantilla guardada no puede reactivar el papel de 50 mm.
- `test:physical-labels:automatic`: páginas vectoriales de cantidades seleccionadas, negro XS, gris M y nombres largos; dimensiones exactas, orientación, ausencia de páginas vacías, márgenes, tipografía, alineación y centrado del identificador. ZXing decodifica SVG y PDF a **300 dpi** y recupera el identificador exacto.
- Navegador real contra el backend local, con autenticación y CSRF: Imprimir selección con 3 etiquetas, Imprimir etiqueta de prueba con 1 y descarga PDF con 3. Los archivos se descargaron desde la interfaz y se inspeccionaron. No se hizo ninguna petición de generación. Selección y cantidades conservadas al plegar; móvil de 390 px sin desbordamiento.
- Vista contextual en navegador: 35 × 62 mm después del giro único −90°, aproximadamente 10 mm negros a cada lado. El documento de impresión sigue horizontal y no incluye el cartón.
- `test:physical-labels:db`: copia desechable local, doce solicitudes concurrentes, persistencia, unicidad, reconexión, reimpresión y conservación de catálogo, stock, pedidos y tiradas. La vista real usa los códigos existentes CRX0000000001 y CRX0000000009, sin generación ni cambios en los registros históricos.
- Se conserva el verificador del antiguo formato de 50 mm como prueba de compatibilidad histórica explícita; no es el formato del flujo automático.
- Backend compilado; comprobaciones TypeScript, `admin:typecheck`, sintaxis JS y `git diff --check`.

Evidencias actuales: `output/playwright/physical-labels-62x35/` y `physical-labels-62x35-tests/`, excluidas de Git. Incluyen `real-labels.pdf`, PNG/SVG reales, cartón contextual, archivos descargados desde los botones y resultados de inspección a 300 dpi.

Archivos principales: DTO y geometría de papel en `cronox-backend/src/admin/labels/`, plantilla automática y composición SVG, servicio, pruebas y verificadores; `cronox-front/assets/admin-labels.js`, versión de carga en `cronox-front/admin.html` y esta documentación. Las migraciones iniciales siguen siendo `20261121120000_physical_barcodes` y `20261121160000_label_template_settings`; esta adaptación no requiere otra.

## Prueba física del diseño actualizado

El usuario confirma que la prueba física anterior con Brother QL-700 fue correcta y que PRUEBA 1 de 62 × 35 mm con Alimentar en 3 mm está creado y probado. Falta probar físicamente **esta distribución actualizada**, especialmente la separación extra de SIZE, el corte, la lectura y su colocación girada sobre el cartón sin tapar agujero ni web. La comprobación por software no sustituye esa prueba. No se ha enviado ninguna etiqueta a la impresora durante esta adaptación.

## Ajuste del margen de textos (22/11/2026)

Solo se desplazan horizontalmente las filas CRONOX: NOMBRE, COLOUR y SIZE. Se mide el borde izquierdo de la primera barra negra real del SVG generado (incluido el ancho del trazo), y se resta el avance de la C en Helvetica Bold de 7 pt. La R queda aproximadamente en ese eje. Con el código actual, las filas pasan de x = 1,55 mm a x ≈ 9,117 mm del papel, un desplazamiento de 7,567 mm. El inicio de la primera barra negra permanece en x = 10,9 mm.

El ancho disponible para los nombres se recalcula desde ese nuevo inicio hasta el margen derecho ya existente; los nombres largos conservan su ajuste con elipsis, sin cambiar de fuente, altura ni invadir las barras. Código e identificador conservan exactamente sus elementos SVG anteriores; coordenadas Y, tipografías y separaciones verticales también son idénticas. El PDF se verifica sobre los trazos vectoriales reales y los caracteres C/R, sin confundir el borde del símbolo con el de su zona de silencio. El cambio se aplica en el renderizador compartido por PDF, impresión y vista previa, sin tocar identificadores ni catálogo. Sin publicar.
