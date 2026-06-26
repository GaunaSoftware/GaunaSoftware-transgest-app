# Checklist de entrega TransGest

Usar esta lista antes de publicar cambios en produccion.

## Versionado

- Trabajar cada bloque en una rama corta con nombre descriptivo.
- Mantener commits pequenos y reversibles: frontend, backend y datos separados cuando sea posible.
- No desplegar backend si hay cambios de esquema sin confirmar que el arranque crea o migra las columnas necesarias.

## Pruebas minimas

- Login con credenciales correctas e incorrectas.
- Crear, editar y listar cliente.
- Crear, editar y listar pedido en Pedidos / Trafico y Gestion de trafico.
- Control Tower: carga de senales, detalle de viaje y mapa.
- Facturacion: generar factura y comprobar vencimiento.
- App chofer: ver viaje, marcar carga/descarga y adjuntar documento.
- Trazabilidad: comprobar que se ve quien hizo el cambio sin exponer IP, rutas tecnicas ni request id.

## Produccion

- Confirmar que Render arranca sin errores y ejecuta indices/esquema.
- Confirmar que Vercel apunta al backend correcto.
- Revisar tiempos de respuesta de las pantallas diarias: dashboard, pedidos, clientes, trafico y Control Tower.
- Comprobar webhooks externos: Stripe con firma, WhatsApp con firma y servicios externos con timeout.

## Limpieza continua

- Cada mejora que sustituya una pantalla debe ocultar o retirar la entrada antigua del menu.
- El codigo legacy no usado debe eliminarse en tandas pequenas, con build y prueba visual.
- Una vista vacia solo debe decir "sin datos" cuando la API haya respondido correctamente.
