# METACRILATOS · referencias aprobadas y prompt para Codex

1. Descomprime esta carpeta en la raíz del repositorio CRONOX que tengas abierto en Visual Studio Code.
2. Adjunta o menciona `metacrilatos-codex/PROMPT.md` en Codex y pídele que ejecute sus instrucciones. También puedes copiar el contenido completo del archivo al chat.
3. Conserva `disenos/` junto al prompt: son las referencias exactas de las cinco versiones aprobadas, no capturas para reinterpretar.

Los HTML de `disenos/` son fragmentos autocontenidos de referencia, con CSS, JavaScript e imágenes incrustadas. No son una integración terminada con el backend. Contienen el usuario de muestra Daniel Rivas, la fecha 17/11/2025, el ID CRX-000001 y un QR que dirige a `https://www.cronox.es`. Codex debe sustituir esos datos por los reales siguiendo el prompt.

`MANIFEST.json` identifica los originales y sus hashes SHA-256. Las copias son exactas. El círculo IV conserva la banda blanca expresamente aprobada; no se debe sustituir por el doble contorno de los otros círculos. Las versiones I y II son negras, III gris y V burdeos.

La implementación y el escaneo de cámara se realizarán en el repositorio local. Este paquete no cambia la web, no contiene credenciales y no activa ningún diseño en producción.

Documentación técnica consultada para las condiciones del lector y la unicidad (comprueba las versiones del repositorio antes de elegir APIs):

- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
- https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-composite-ids-and-constraints
