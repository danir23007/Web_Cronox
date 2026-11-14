# Confirmación de pedido: fotos, anillos y cuerpo común

## Alcance

Se conservan las cinco tarjetas existentes de Pedidos, sus IDs y la selección automática por círculo. La entrega corrige las fotos de producto, hace opaco el blanco del IV, restaura el rojo del V y prepara la actualización del cuerpo de I a partir del documento compartido por II–V. No cambia importes, impuestos, enlaces ni datos reales del pedido. No requiere migraciones ni nuevas dependencias.

## Fotografías

SCARRED TEE roja reproduce el problema: original PNG de 3973 × 5298 y variante pequeña de 450 × 600; ambos conservan aproximadamente 3:4. El correo imponía 70 × 70. En HTML importado, `object-fit:cover` tampoco era una solución: el sanitizador no lo conserva y no es fiable en todos los clientes de correo.

Ahora se leen el ancho y alto de la imagen seleccionada del mismo producto del pedido y se calculan sus dimensiones dentro de 70 px. El HTML lleva atributos `width` y `height` proporcionales, dentro de una tabla compacta con fondo blanco, centrado horizontal y vertical y espacio de relleno. No depende de `object-fit`. Las fotos antiguas sin metadatos conservan su proporción intrínseca con límites CSS, en lugar de forzarlas a un cuadrado.

Preview utiliza los metadatos de la foto del producto elegido. El envío usa la foto del producto comprado y la talla de su variante real; no toma los productos ficticios de Preview. Las dimensiones son variables del artículo admitidas únicamente en Confirmación de pedido.

## Anillos

La geometría sigue siendo 640 × 1400, centro (450,700), radios de fuera hacia dentro 268,220,172,124,76 y posicionamiento `70% center`. Los PNG de I–III y ambos logos se conservan byte a byte.

- IV: segundo desde dentro, `#FFFFFF`, trazo de 2 px y opacidad 1. El centro del trazo en (450,576) es RGBA (255,255,255,255) en ambos temas. Se conserva el apoyo neutro suave en claro. URL de recurso `?v=3`.
- V: interior, vuelve a `#B1001A`. Esta es la referencia histórica de `RING_COLORS[5]` en `cronox-front/assets/profile.js` del commit `48ce017c402f11616a75dd328bee2d1af76fb326`, anterior a la entrega blanca. Los PNG del correo se incorporaron por primera vez a Git ya blancos; se regenera el recurso con ese rojo histórico exacto, sin inventar otra tonalidad. URL `?v=4`.
- Solo el anillo activo usa el color de su círculo. Los otros cuatro siguen siendo neutros y tenues.

## Cuerpo y publicación

Las cuatro tarjetas II–V tienen el mismo documento, descontando únicamente su identidad de círculo. Para I se copia ese documento preparado de II y se establece `orderCircle:1`; se conserva el ID, carpeta, nombre, asunto, texto previo y demás metadatos de I. No se convierte el catálogo en una plantilla genérica ni se crean tarjetas nuevas.

La operación de producción debe volver a comparar los documentos actuales con los revisados y conservar las clasificaciones productivas, que están fuera del alcance. Después del despliegue se guardan y publican por separado las cinco tarjetas mediante el servicio existente: las nuevas versiones contienen el HTML proporcional y, en I, el cuerpo común. Se conservan las versiones anteriores como historial y las cinco claves `ORDER_CONFIRMATION:CIRCLE_1` … `CIRCLE_5`.

## Validación

- Pruebas del cálculo proporcional con fotos verticales, horizontales, cuadradas y dimensiones reales de SCARRED TEE; HTML por bloques e importado, atributos nativos, fuente y talla correctas e idempotencia.
- Pruebas de los diez PNG, cinco trazos distinguibles, radio activo, IV opaco y rojo histórico exclusivo del V.
- Comparación de los cinco cuerpos con el mismo pedido ficticio, tanto en Preview como en EmailService con transporte en memoria. Mismos importes y contenido; solo cambia el fondo.
- 20 Preview del administrador con SCARRED TEE y 40 renderizados adicionales de Preview/HTML automático con tres fotografías de distintas proporciones, en claro/oscuro y escritorio/móvil. Se comprueban proporción, centrado, marco compacto, imágenes cargadas, ausencia de desbordamientos y fondo correspondiente.
- Comparación previa de solo lectura con producción; sin cambios fuera de esta corrección. Evidencia privada en `output/playwright/order-correction/`, excluida de Git.

La comprobación productiva usa Preview y el flujo automático de la aplicación con datos ficticios y transporte exclusivamente en memoria. No crea pedidos ni envía correos a clientes. La recepción física en Gmail/Outlook y sus cambios automáticos de tema no se presenta como verificada.
