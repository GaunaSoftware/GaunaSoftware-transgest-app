# Entrega operativa · 15 de septiembre de 2026

## Cambios incluidos

- Pedidos: eliminación múltiple con motivo común o individual, motivos para cancelación/incidencia en lote y conservación de los pedidos fallidos en la selección. Se respetan los bloqueos de facturación.
- Portal de clientes: puntos con código postal y enlace de mapa, conservación de estos datos al convertir una solicitud en pedido, cálculo de kilómetros con advertencias del proveedor de rutas y peso con unidades explícitas. 24,2 toneladas se guardan como 24.200 kg.
- Dashboard: los pedidos sin cerrar cuya fecha prevista ya venció se muestran como incidencias por vencimiento, separados de la operativa en curso. No se reescribe automáticamente su estado real. Se muestran las descripciones de las incidencias.
- Soporte: conversaciones persistentes por usuario y empresa; respuestas y cierre desde Superadmin → Soporte. Actualización mientras la bandeja está abierta. No depende de una aplicación de correo externa.
- Superadmin: cambio transaccional del correo del administrador y de su acceso. No cambia las cuentas de otros usuarios. Las invitaciones pendientes del correo anterior se invalidan.
- Planner: cargas, stock/almacén, reservas de muelles, gestión de viajes, conductores y flota propia, proveedores e Intelligence sobre el mismo backend. Los solapamientos de reservas se comprueban bajo bloqueo de fila.
- Intelligence: consultas de existencias y reservas de muelles, limitadas por permisos y empresa. Continúa siendo de consulta; no ejecuta cambios de stock ni asignaciones.
- Colaboradores: invitación por correo con enlace caducable, portal operativo limitado, matrícula propia y alta de conductores externos. Estos solo acceden a sus viajes y documentos; no a vacaciones, tacógrafo ni facturación. Albaranes/POD se pueden adjuntar también tras entregar el viaje.
- Correo de carga: un envío simulado por falta de SMTP ya no se comunica como enviado. Se conservan los mecanismos existentes de aceptación desde enlace y operativa del viaje.
- Mesa de tráfico: evita asignar pedidos de otro vehículo/colaborador y no hereda el conductor anterior al elegir una tractora distinta.
- Mapas: colores por estado en los puntos operativos y en la vista de ruta de tráfico.
- Costes: estimación de combustible cuando la API recibe kilómetros y no se ha indicado un coste, respetando importes manuales. En el formulario se puede calcular/recalcular el gasoil de viajes existentes. Peajes, dietas y otros gastos requieren sus datos reales; no se inventan.
- Facturación: errores concretos con los datos fiscales que faltan y la ficha que debe completarse.
- Contraste del botón para adjuntar pedidos en modo claro y texto de email en login.

## Publicación

Desplegar frontend y backend desde el mismo commit. El envío a GitHub no acredita un despliegue en Render/Vercel.

1. Backend: instalación habitual y arranque desde `transgest-backend`. Las tablas nuevas de soporte y muelles se crean de forma idempotente al utilizar sus rutas. El portal de colaboradores añade la referencia al conductor externo al inicializarse. El usuario de PostgreSQL necesita los permisos de migración que utiliza el proyecto.
2. Frontend TMS: `npm run build` en `transgest-frontend`.
3. Frontend Planner: misma fuente y API; compilar con `REACT_APP_PRODUCT=planner`. `REACT_APP_API_URL` debe contener el origen del backend, sin `/api/v1`. Para publicar dos webs, usar dos builds/proyectos.
4. Backend: configurar `APP_URL` con la URL pública donde se aceptan las invitaciones. Las cuentas de proveedor funcionan también desde la web TMS.
5. Configurar SMTP desde la configuración de correo de empresa o la configuración de plataforma. Ejecutar la prueba de correo existente antes de reenviar invitaciones/cargas. Revisar `email_log` y la entrega en el buzón destinatario. No se han enviado correos reales durante estas pruebas.
6. Intelligence sigue requiriendo su configuración de API y un plan/perfil que lo permita. Las distancias pueden ser aproximadas si falla el proveedor: el portal muestra la advertencia.

Las cuentas de acceso están en `usuarios` (vinculadas por `empresa_id`). El contacto administrativo/facturación de `empresas` y los datos fiscales de Mi empresa son registros distintos. El resto de cuentas se administra desde Usuarios y roles.

## Verificación reproducible

En backend:

```text
node scripts/production_workflows_check.js
node scripts/production_database_check.js
node scripts/supplier_invitation_check.js
node scripts/supplier_planner_regression_check.js
node scripts/intelligence_regression_check.js
```

En frontend:

```text
npm run build
npm test -- --watchAll=false --runInBand --runTestsByPath src/pages/dashboard/operationalStatus.test.js
node scripts/production_browser_check.cjs
node scripts/latest_workflows_browser_check.cjs
```

Las pruebas de navegador usan Playwright con Edge y una API simulada; `PLAYWRIGHT_MODULE` permite indicar una instalación local de Playwright. Para Planner, compilar con `REACT_APP_PRODUCT=planner` y `BUILD_PATH=build-planner`, y ejecutar `production_browser_check.cjs` con el mismo `BUILD_PATH`.

Las pruebas PostgreSQL usan PGlite sin acceder a datos de producción. Verifican privacidad, persistencia de direcciones, cambio de correo, invitaciones, documentos y reservas. Quedan fuera de la verificación local la entrega real SMTP, las credenciales de Intelligence/mapas y el estado del despliegue público. La cuenta demo no se ha modificado ni se han sobrescrito costes históricos.
