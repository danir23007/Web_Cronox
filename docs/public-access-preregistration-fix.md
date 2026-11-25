# Acceso público y Pantalla Clave · 25/11/2026

La configuración persistente de producción tenía el prerregistro activado, sin caducidad. El middleware servía correctamente la pantalla antigua a visitantes anónimos y usuarios normales; la excepción de vista previa administrativa explicaba que el administrador viera la tienda. Black Friday ya utiliza una tabla y endpoints independientes. No se encontró una programación de reactivación ni un service worker que almacenase la pantalla.

Se abrió el acceso mediante una transacción controlada que modificó exclusivamente el interruptor del prerregistro. Se conservaron pantalla seleccionada, caducidad, registros, historial de lanzamiento y toda la fila de Black Friday. La comparación transaccional de entregas, trabajos de newsletter y envíos de buzón confirmó que no se enviaron ni encolaron comunicaciones. El servicio de lanzamiento está retirado y no ejecuta un worker.

Los controles del administrador identifican expresamente el bloqueo público y la campaña visual. Activar el bloqueo requiere confirmación explícita. Desactivarlo también desarma un posible estado histórico ARMED, sin convertirlo en SENDING; los lanzamientos COMPLETED se conservan. No se introduce un apagado forzoso en cada despliegue: el prerregistro sigue disponible para activación manual futura.

Los DTO rechazan campos del otro formulario y la escritura de campaña enumera sus campos permitidos. Las respuestas HTML públicas conservan una política privada sin almacenamiento y varían por Cookie tanto abiertas como bloqueadas. Las rutas privadas mantienen su autorización.

La corrección no necesita migraciones. Las pruebas cubren visitantes sin cookies, usuarios normales, vista previa administrativa, rutas públicas, caché, campos cruzados y desactivación sin transición de correo. La verificación productiva utiliza contextos nuevos de navegador sin almacenamiento previo, sin registros, compras ni envíos reales.
