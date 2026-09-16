# TransGest Planner: funcionamiento y verificación

## Activación

En SuperAdmin, editar la empresa y seleccionar **TransGest Planner** para almacén y expediciones, o **TransGest Pro Planner** para combinarlo con flota y viajes. Guardar y renovar la sesión de empresa. El espacio se abre en `/planner`; en la modalidad combinada se puede volver a TransGest. Los planes anteriores conservan la activación adicional de productos. Los nuevos planes determinan su modalidad; no se han inventado tarifas comerciales.

Los permisos de usuario siguen siendo obligatorios: Pedidos para cargas/muelles, Almacén para inventario y Facturación para facturas. Documentos requiere acceso a documentos, pedidos y almacén. Las cuentas externas usan su portal limitado.

## Flujo de mercancía

1. Crear artículos con referencia, unidad, coste, venta, peso por unidad y unidades por palet. El margen se expresa sobre la venta; no incluye gastos generales ni de transporte.
2. Registrar recepción, fabricación, devolución o ajuste, identificando almacén, ubicación, lote y motivo. Los ajustes no pueden consumir stock reservado.
3. Crear la carga con cliente y puntos de entrega. Preparar mercancía distribuyendo las cantidades entre sus paradas. La reserva reduce disponible sin descontar stock físico.
4. Verificar cada línea y marcar la preparación como lista. Se conservan los precios y características del artículo de ese momento.
5. Asignar el transportista y enviar el encargo con el flujo de correo existente. La aceptación se registra por enlace o aplicación. Solicitar/asignar hueco de muelle.
6. Registrar espera, carga y camión cargado. Confirmar expedición descuenta el stock una sola vez. Cancelar una preparación libera la reserva y conserva el historial; se puede crear otra.
7. Generar el albarán PDF y acceder al DCD en Documentos. El DCD utiliza la configuración y validaciones existentes de la empresa y del pedido.
8. Si procede, crear factura de mercancía desde la preparación expedida. El servidor obtiene sus cantidades/precios; exige la revisión documental antes de emitir. Es independiente de la factura de transporte.

## Muelles

Cada muelle tiene almacén, días, apertura/cierre, zona horaria, capacidad y margen entre reservas. Las reservas se validan bajo bloqueo de base de datos: no se admiten solapes ni una segunda reserva del mismo tipo para una carga. El calendario muestra horas de la zona del dispositivo, indicada en pantalla; el servidor valida la zona configurada en el muelle. La capacidad compara los palets indicados y los de la preparación.

## Transportistas

- El colaborador invitado y sus conductores utilizan el portal limitado existente. Pueden trabajar con sus encargos y entregar POD; no acceden al almacén interno ni a facturación.
- El gerente de un transportista con TransGest Pro puede aceptar el enlace en `/transportistas/conexiones`. Debe vincular a su cliente cargador; se contrastan los NIF/CIF de ambas empresas y se solicita consentimiento para la conexión.
- Se crea un único viaje en la empresa transportista, con el precio que le corresponde. No se copia el precio de venta del cargador ni sus costes internos.
- Con la aplicación abierta, la sincronización se comprueba cada minuto; también existe un botón manual. Los siguientes encargos aceptados se incorporan y vuelven estados operativos, matrículas y POD. La conexión puede desactivarse desde cualquiera de las empresas.
- El transportista puede solicitar hueco y descargar el albarán de salida disponible.
- Los vehículos autorizados conservan versiones documentales. Autorizar requiere documentos vigentes; cambiar un documento exige nueva revisión. Es un registro de revisión humana, no una certificación automática de cumplimiento legal.

## Despliegue

Ejecutar `npm run migrate` en el backend para aplicar **019_planner_inventory.sql**, con copia de seguridad previa y los mismos controles de despliegue existentes. Añade tablas Planner y amplía el peso de los pedidos a tres decimales; no elimina datos. El backend conserva inicialización compatible si se accede al módulo antes de ejecutar las migraciones.

Mantener la configuración pública `APP_URL`/`FRONTEND_URL` para que el correo abra la web correcta, la configuración SMTP real y la de DCD del emisor. Las pruebas locales interceptan los envíos de correo: no acreditan su recepción en un buzón real.

## Verificaciones realizadas

- `npm run check`: sintaxis, aislamiento por empresa y regresiones operativas, geográficas, facturación, muelles y proveedores.
- `npm run security:regression`: permisos, privacidad, SSRF, secretos y SMTP aislado.
- `npm run audit:regression`: ciclo mediante rutas reales con PostgreSQL compatible aislado; fabricación → reserva → picking → albarán PDF → expedición → borrador → revisión → emisión. Conexión de dos empresas, aceptación repetida, precio privado, estados, POD y revocación; vehículos/documentos/autorización.
- Frontend: tests Jest y build de producción. Navegador local con API simulada para pantallas, alta de referencia y móvil, sin errores JavaScript ni desbordamiento de página.
- PDF multipágina renderizado y revisado visualmente; las líneas de artículo permanecen juntas y la numeración no genera páginas en blanco.

## Prueba de aceptación tras desplegar

Usar dos empresas de pruebas y un buzón controlado. Activar Planner y Pro respectivamente, crear un artículo y una carga de dos entregas, preparar mercancía y enviar el encargo. Verificar recepción real del correo, aceptación, viaje único, petición/confirmación de hueco, DCD real, salida de stock, POD desde el conductor y factura revisada. Probar también acceso externo y desactivación de la conexión.

Esta prueba con servicios reales todavía debe realizarse en el entorno desplegado. Los listados recientes indican sus límites (200 movimientos, 300 preparaciones/albaranes); las exportaciones corresponden al listado cargado. No se han añadido métricas ni datos ficticios para reproducir las capturas.
