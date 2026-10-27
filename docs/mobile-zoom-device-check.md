# Comprobación voluntaria en un móvil afectado

Objetivo: capturar el estado «ampliado» **antes de alejar con los dedos**. No cambiar los ajustes de accesibilidad para la primera prueba. El diagnóstico de apertura ampliada sigue abierto.

1. Anotar manualmente modelo, versión del sistema, **nombre y versión exactos del navegador** (su pantalla «Acerca de»), tamaño de texto y de pantalla del sistema, tamaño de fuente/zoom del navegador, modo escritorio y modo oscuro/oscurecimiento de webs. Basta con valores o posiciones de los controles; no exportar el perfil del navegador ni su User-Agent completo.
2. En una pestaña nueva, entrar escribiendo `cronox.es`; repetir por el QR si está disponible. Anotar solo si redirige y a qué tipo de página llega, **sin compartir enlaces con tokens, identificadores ni parámetros personales**. Distinguir navegador externo de navegador integrado en otra app. No borrar cookies ni preferencias en la primera pasada. La web publicada no incorpora los cambios locales de esta tarea.
3. Sin tocar campos ni hacer gestos, observar al abrir, a los 2 segundos y a los 10–12 segundos. Anotar cuándo parece ampliarse. Registrar si el aviso de cookies está abierto; cerrarlo con la opción elegida por la persona y observar la newsletter. Después tocar su email **sin escribir**, cerrar el teclado/modal y abrir acceso; cambiar a registro. Repetir la secuencia relevante en horizontal. Marcar el paso exacto que dispara el síntoma. Si no aparece newsletter, anotarlo; no forzarla borrando datos.
4. Si aparece el problema, medir primero; después, si la persona quiere, alejar con los dedos y medir otra vez. Registrar si cambian toda la página, solo los textos o el espacio fuera de pantalla. Repetir en la versión corregida servida desde el ordenador mediante depuración/port forwarding USB local. El servidor de pruebas es `node tests/mobile-compat/server.cjs`, puerto 4185, con datos ficticios; no hace falta publicar nada. Que otro navegador funcione no valida el navegador afectado.
5. Compartir únicamente navegador/versión, ajustes, pasos y las medidas revisadas que la persona decida facilitar. Una captura es opcional: recortar u ocultar nombre, fecha personal, QR, cuenta, notificaciones y pestañas. No enviar HAR, cookies, almacenamiento, credenciales ni contenido de formularios.

## Medidas opcionales con ayuda técnica

Si el navegador admite inspección remota, cargar manualmente en su consola el contenido de [`voluntary-zoom-diagnostics.js`](../tests/mobile-compat/voluntary-zoom-diagnostics.js). **Cargarlo no registra nada**. Para empezar, ejecutar y aceptar su confirmación:

```js
CRONOXZoomDiagnostic.start()
```

Registra durante un máximo de 30 segundos, cada 250 ms y ante cambios de foco/viewport/fuentes. En cada paso relevante, y antes/después del gesto manual:

```js
CRONOXZoomDiagnostic.mark()
```

Detener y obtener el JSON, que debe revisarse antes de copiarlo o compartirlo:

```js
CRONOXZoomDiagnostic.stop()
CRONOXZoomDiagnostic.exportJSON()
// Opcional: borrar las muestras de esta página.
CRONOXZoomDiagnostic.clear()
```

El script solo mantiene medidas en memoria. No lee valores/textos de formularios, nombres, identificadores de elementos, URL, parámetros, QR, cookies o almacenamiento. No transmite, guarda ni descarga nada. No cambia estilos, tamaño de texto, viewport ni foco de la página; la confirmación nativa inicial sí interrumpe momentáneamente la interacción. No se incorpora al HTML público. Recargar elimina el script y las muestras; parar desconecta sus observadores y temporizadores.

**Límite temporal:** al pegarlo después de cargar, solo describe el estado a partir de ese momento; no prueba qué ocurrió en la primera pintura. Si el defecto solo dura unos instantes, hace falta una sesión técnica instrumentada antes de navegar, autorizada expresamente por la persona, con un registro de cuándo se inició. El consentimiento debe obtenerse antes de esa sesión, sin mostrar diálogos en mitad de la secuencia investigada. El bypass de confirmación del test automatizado es exclusivo de datos ficticios; no debe copiarse al teléfono de alguien. Si no se dispone de inspección remota, conservar el relato de pasos y dejar las medidas pendientes, sin inferirlas de una fotografía.

## Cómo interpretar las medidas

| Señal | Interpretación y límite |
|---|---|
| `visual.scale` aumenta y `visual.width` disminuye, mientras `clientWidth` se conserva | Compatible con zoom del viewport. Comparar antes/después del gesto; una foto no permite medirlo. |
| Escala estable, pero aumentan `fontSize`, `lineHeight` o las cajas de glifos | Compatible con ampliación de texto. `textSizeAdjust` es una pista, no una medida suficiente por sí sola. Comparar los mismos elementos, estado y orientación. No restaurar a la fuerza las preferencias de la persona. |
| `scrollWidth > clientWidth` | Hay desbordamiento del documento. `innerWidth` puede ampliarse por ese contenido; por sí solo no demuestra zoom. Los elementos de una escena 3D o un panel oculto fuera de pantalla no prueban desbordamiento efectivo. |
| Baja solo `visual.height`, con escala/ancho estables, al tocar un campo | Compatible con teclado o barras del navegador; no basta para concluir zoom. La emulación de escritorio no reproduce un teclado físico. |
| `zoom` o `transformed` cambian solo en un componente | Puede ser ampliación CSS local, distinta del zoom del navegador. Revisar ese componente y sus ancestros con ayuda técnica. |

Registrar `innerWidth/innerHeight`, `clientWidth/scrollWidth`, viewport meta, `visual.width/height/scale/offsets`, DPR, ancho/alto de pantalla, foco por tipo de control y estilos calculados; el script recoge esas medidas. El zoom guardado de página, la ampliación del sistema y ciertos navegadores pueden no reflejarse igual en `visual.scale`: contrastar siempre los ajustes manuales. Los mecanismos pueden coexistir.
