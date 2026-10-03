# Publicación y validación del administrador, 3 de octubre de 2026

Este registro conserva la evidencia útil de las revisiones anteriores sin direcciones personales de prueba, credenciales, cookies, identificadores de sesiones, cuerpos ni adjuntos. Es un registro histórico; esta limpieza solo crea commits locales, sin conexión al VPS, push ni despliegue.

## Publicaciones ya realizadas

| Cambio | Commit | Despliegue verificado |
|---|---|---|
| Correo, conciliación diaria de visitantes y Home | `2c508b7` | [Correcto](https://github.com/danir23007/Web_Cronox/actions/runs/37085221447) |
| Preparador compatible con la inspección root del repositorio de deploy | `a5957e4` | [Correcto](https://github.com/danir23007/Web_Cronox/actions/runs/37086222644) |
| Transporte push compatible con selección automática de familia de Node 22 | `373400f` | [Correcto](https://github.com/danir23007/Web_Cronox/actions/runs/37091049450) |

El despliegue existente aplicó `20261002160000_admin_mailboxes` y `20261002200000_visitor_daily_reconciliation`. La comprobación posterior confirmó 65 migraciones terminadas, ninguna pendiente, backend operativo e histórico financiero conservado. No hubo reset, borrados de entidades reales ni copia nueva de la base de datos.

## Resultado del correo

Soporte, Pedidos, No-reply e Info quedaron conectados con TLS y autenticación IMAP/SMTP correctos desde el backend del VPS. Cada uno conserva su dirección de remitente y su referencia privada correspondiente. La sincronización, el envío manual y los avisos de nuevos mensajes quedaron habilitados en los cuatro, manteniendo los permisos existentes.

La revisión comprobó cinco carpetas por buzón, importación completa, ciclos posteriores sin duplicados y conservación de los estados de leído comparados. Soporte siguió funcionando al incorporar los demás. La cola estaba vacía antes de habilitar envío. Las cuatro pruebas autorizadas fueron aceptadas por SMTP, guardadas en Enviados y el operador confirmó su recepción en Gmail. No hay que repetirlas para validar esta limpieza.

Los avisos se habilitaron después de la importación, con corte de notificación nuevo y cero avisos históricos. Las claves de cifrado y VAPID de producción son distintas de las locales. El volumen persistente privado se comprobó desde el backend; deploy no puede acceder a él y las rutas públicas probadas devolvieron 404. Los controles del panel se comprobaron a 1440×1000 y 390×844 sin abrir mensajes privados.

## Push: comprobado en servidor, prueba automática física pendiente

El iPhone quedó registrado. La respuesta del operador a Soporte se importó y generó un aviso, pero el transporte devolvía una respuesta DNS escalar cuando Node 22 pedía `lookup({ all: true })`. Eso producía `ERR_INVALID_IP_ADDRESS` antes de contactar con Apple. El arreglo conserva la IP pública previamente validada y respeta ambos contratos de lookup. Pasaron 33 pruebas del módulo y la compilación del backend.

Apple aceptó un aviso técnico y, tras el despliegue, el trabajador normal envió el único aviso fallido reintentado. El contador de fallos del dispositivo pasó a cero sin reenviar el correo. El operador recuerda haber recibido notificaciones, pero no identifica de forma inequívoca el aviso automático de correo: **esa prueba física permanece pendiente**.

Prueba controlada posterior, a realizar por el operador cuando quiera completarla:

1. Abrir CRONOX desde el icono instalado del iPhone y comprobar en Correo → Notificaciones que el dispositivo está activo y Soporte está seleccionado.
2. Salir de CRONOX. Desde una cuenta propia, enviar un único correo nuevo a `support@cronox.es`, con asunto identificable, por ejemplo `PRUEBA PUSH AUTOMÁTICO — fecha y hora`.
3. Bloquear el iPhone y esperar hasta dos minutos. Buscar el aviso `CRONOX · Correo` en la pantalla bloqueada o en el centro de notificaciones. Puede tener texto genérico si los detalles están desactivados.
4. Registrar si apareció, a qué hora y si al tocarlo abre CRONOX. Si falta, revisar por separado importación, creación del aviso y resultado del trabajador; que el correo esté en webmail no acredita entrega push. No repetir envíos ni reintentar avisos de forma indiscriminada.

Durante la limpieza no se ejecuta esta prueba ni se envía ningún correo o aviso.

## Home, visitantes e histórico

Home se comprobó primero, como entrada principal y predeterminada, sin Atrás, en escritorio y móvil. Se conservaron rutas, permisos, contenido, gráficas y filtros. Gráfica, detalle y paginación de visitantes compartían totales; el acceso anónimo devolvió 401 y USER devolvió 403. La prueba administrativa añadió cero visitas contabilizadas.

En Europe/Madrid, el histórico original comenzó el **02/10/2026 a las 15:21:35.932**. El marcador de las reglas nuevas se guardó el **03/10/2026 a las 03:18:12.011**; el backend nuevo arrancó a las **03:18:32.700** y el despliegue se confirmó a las **03:18:36**. El día 3 es de transición; el primer día natural completo con las reglas nuevas es el 4. No se inventaron relaciones ni roles anteriores.

## Material conservado y retirado

Las pruebas de navegador reutilizables se conservan en [tests/admin-review](../tests/admin-review/README.md), además de las suites, migraciones y preparadores ya versionados. Los esquemas y manifests de auditoría eran copias exactas de `f1669f2`; los informes de auditoría mantuvieron los 15 avisos preexistentes ya documentados, sin añadir avisos nuevos del módulo.

Las capturas y resultados brutos son prescindibles y no se incorporan a Git. Se retiraron el PDF sintético, las copias de texto para auditoría y los scripts puntuales de publicación, activación, envío y reintento. No forman parte del procedimiento permanente ni deben ejecutarse contra una instalación ya activa. Los archivos privados locales, claves y almacenamiento se conservan fuera de Git.
