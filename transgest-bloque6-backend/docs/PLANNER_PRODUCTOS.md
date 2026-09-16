# Activación de Planner y TransGest

Los productos se habilitan por empresa, desde **Superadmin → Empresas → Editar → Productos habilitados → Guardar productos**.

- **Solo TransGest:** mantiene la aplicación de transporte y sus permisos actuales.
- **Solo Planner:** abre directamente Planner con cargas, muelles y horarios, almacén, proveedores, destinatarios y documentos. La flota propia y la planificación de viajes requieren la combinación.
- **TransGest + Planner:** muestra el acceso Planner en el lateral de TransGest y permite volver desde su cabecera. Los pedidos, clientes y movimientos pertenecen a la misma empresa; no se copian entre productos.

Para probar Planner en una empresa de TransGest, selecciona ambos y recarga la sesión de esa empresa. Puedes entrar también por `/planner`. Para una prueba aislada, usa una empresa de demostración: los datos guardados en Planner son reales. Al deshabilitar un producto se conserva la información.

El selector habilita acceso: no crea suscripciones, no modifica precios ni realiza cobros. El plan, los permisos de usuario y los productos habilitados son controles distintos. No hay vencimiento automático de pruebas en esta configuración.

## Publicación

Desplegar primero backend y después frontend. El backend crea de forma idempotente `empresa_productos` (requiere permisos CREATE TABLE). La configuración no se almacena en un campo modificable desde Mi empresa. Las empresas sin configuración conservan TransGest; una instalación independiente con `TRANSGEST_PRODUCT=planner` conserva Planner como producto por defecto. La configuración explícita por empresa prevalece.

La compilación independiente `planner:build` continúa disponible. La web normal también sirve `/planner`, sin necesitar una segunda cuenta o duplicar la empresa. Se puede publicar esa compilación en un dominio propio; el dominio no concede permisos adicionales.

## Comprobación tras desplegar

1. Con una empresa de pruebas, guardar Solo TransGest: Planner no aparece y `/planner` muestra que no está habilitado.
2. Guardar ambos y recargar: abrir Planner, crear una carga de prueba, crear un muelle y reservar un hueco; comprobar los datos guardados y el mismo pedido en TransGest.
3. Guardar Solo Planner: abrir `/` y comprobar que entra en Planner. No aparece la gestión de flota propia ni el enlace de vuelta a TransGest.
4. Probar un visualizador: puede consultar los módulos autorizados, sin crear cargas o reservas.
5. Volver a Solo TransGest: se retira el acceso Planner sin borrar cargas, stock o reservas.

Las pruebas automáticas usan API/base de datos simuladas. El guardado real y la configuración del despliegue deben comprobarse en el entorno publicado.
