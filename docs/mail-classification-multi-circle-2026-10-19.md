# Guardado de clasificación visual en varios círculos

## Causa y corrección

El selector marcaba la edición y enviaba `visualClassification`, pero `saveDrafts` escribía ese campo solo en el origen. Además, siempre copiaba asunto/documento/HTML/texto a los destinos, incluso al cambiar únicamente el color. La detección de copias usaba finalidad y buzón, mezclando potencialmente diseños distintos. La prueba anterior de PostgreSQL incluso esperaba conservar el color antiguo del destino; se corrigió esa expectativa.

Se conserva la ventana «¿Dónde quieres guardar estos cambios?» y «Guardar en seleccionados». El formulario compara con el borrador cargado y distingue clasificación de contenido. El servidor comprueba esa distinción sobre el registro persistido; no confía solo en el indicador del navegador.

- Solo color: cada destino recibe clasificación, revisión y metadatos de edición/auditoría. No se renderiza, normaliza ni copia documento, HTML, texto, asunto, imágenes, firma o personalizaciones.
- Edición expresa de contenido: conserva el guardado múltiple. Un guardado posterior sin cambio de color conserva las clasificaciones de los destinos, incluso si un cliente anterior incluye el color inalterado del origen.
- Identidad: `familyId` o `importKey` completo, incluido el sufijo de diseño. La bienvenida aprobada no se agrupa con la antigua. Un identificador desconocido no se interpreta por nombre/finalidad.
- Borradores manuales sin relación: candidatos sin vínculo de importación/familia del mismo buzón/finalidad, sin selección automática. La ventana explica la ambigüedad y muestra nombre e ID; exige selección explícita y una sola copia por círculo. No establece vínculos permanentes.
- Solo las cinco carpetas canónicas existentes. No se crean plantillas/carpetas para completar selecciones.
- Revisión, buzón/diseño, papelera y unicidad por círculo se validan antes de escribir. Bloqueo ordenado de filas y transacción para evitar cambios parciales.
- La respuesta identifica destinos, revisiones y clasificaciones persistidas. La interfaz exige confirmación de todas las copias antes de mostrar éxito y nombra los círculos afectados. El fallo conserva edición/selección y aparece dentro de la ventana. Cancelar no escribe ni fija selección futura.

Sin cambios de esquema, migraciones, publicación, destinatarios, automatizaciones ni diseño del correo. Se mantienen permisos administrativos y CSRF.

## Verificaciones

271 suites / 2.913 pruebas correctas. Typecheck de frontend/backend y compilaciones correctos. Regresiones de color aislado, guardado posterior de contenido, respuesta incompleta, selección retenida tras error, cancelación, familia y texto alternativo.

PostgreSQL local desechable: tres colores, 1/3/5, uno/todos, contenido distinto intacto, identidad de diseño/buzón, selección manual, revisiones obsoletas, fallo de escritura con reversión real de todas las anteriores, concurrencia con una sola ganadora e historial/publicaciones intactos. Pasan también los diez grupos previos de clasificación/papelera, incluidas carreras con planificación de campañas.

Administrador real con Playwright, login y CSRF legítimos, base aislada en `127.0.0.1:5433`, aplicación `localhost:43129`, sin SMTP/trabajadores activos:

1. Desde Círculo 3, verde en 1/3/5; 2/4 conservan morado.
2. HTTP 503 controlado: conserva edición y destinos, sin escritura; reintento normal correcto.
3. Seleccionar todos y cancelar: ninguna escritura. Nueva operación selecciona solo el actual.
4. Azul solo en 3, morado en los cinco, azul en los cinco desde Círculo 1.
5. Cierre, cambio de carpeta, reapertura y recarga: tarjetas/selector conservan la clasificación. Otro diseño con igual nombre/finalidad mantiene su color.
6. Tras aplicar a todos, verde únicamente en Círculo 1: los demás siguen azules, sin sincronización permanente.
7. Dos candidatos manuales en Círculo 1: selección explícita, exclusión mutua y cancelación sin cambios.
8. Editar asunto desde Círculo 3 a 1/3/5: contenido guardado, verde de 1 y azul de los demás conservados.

Cada resultado se consultó con otro cliente PostgreSQL. Ninguna prueba usa SMTP ni activa plantillas; no se escriben pedidos/promociones ni datos productivos. La base desechable y el administrador aislado se eliminan al terminar. Evidencia privada fuera de Git: `output/playwright/mail-color-fix/` y `test-results/mail-classification/`.

## Publicación y comprobación productiva

Corrección subida a `main` y desplegada como **`b183d238c11d29fa1d06f3782d008eebb2fc602a`** mediante la autorización previa y el procedimiento habitual:

- [CI del push](https://github.com/danir23007/Web_Cronox/actions/runs/39246870850): success.
- [Publicación única](https://github.com/danir23007/Web_Cronox/actions/runs/39247493627): verify-release y deploy correctos. Controlador en `success`, public_check completo a las **13:58:08 Madrid** (11:58:08 UTC).
- Respaldo de base/roles/aplicación y restauración aislada verificados: **297 objetos comparados y cero diferencias**. El diagnóstico recoge `POSTGRES_SHUTTING_DOWN` durante el cierre del entorno aislado; no bloqueó la comprobación ni la publicación. No se ejecutó restauración sobre la base productiva.
- HEAD remoto comprobado igual al SHA esperado. Portada, health y ready 200 en ambos dominios. `admin-mails.js?v=8` y `admin-mails.css?v=4` servidos con el contenido de esta entrega.
- Comparación antes/después del registro completo de las **106 plantillas**, incluyendo `visualClassification`: idénticos. Las **20 carpetas** mantienen sus identidades y datos; versiones/publicaciones permanecen intactas. Las **103 migraciones** y sus checksums están sin cambios, sin nuevas migraciones. Configuración de entorno y flags operativos conservados; Correos sigue desactivado.
- Consulta productiva de `draftTargets`: la bienvenida antigua desde Círculo 3 ofrece exactamente sus cinco identidades originales. «Bienvenida · Diseño aprobado» ofrece únicamente su identidad independiente y continúa como borrador sin publicación activa.
- Panel productivo con sesión legítima: selección temporal de verde desde Círculo 3, ventana con los cinco destinos correctos y aviso «Se guardará solo la clasificación visual»; se seleccionaron 1/3/5 y se canceló. Cero PATCH de plantillas. Se volvió a comparar la base después: los 106 registros siguen íntegros. El guardado con escritura se verificó previamente contra PostgreSQL aislado, no modificando clasificaciones productivas para probar.

Sin correos, activación de plantillas, reencolados ni cambios en el diseño de bienvenida. Base y sesión de prueba eliminadas; servidor local habitual actualizado y con SMTP/trabajadores desactivados. El cierre se sube mediante un commit documental, sin otro despliegue de aplicación. Los artefactos privados quedan fuera de Git y se conservan los cambios previos de dependencias y el archivo de respaldo ajeno existentes en el VPS.
