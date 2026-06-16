# Manual operativo de TransGest

Este manual resume el uso diario recomendado para que la empresa trabaje con datos consistentes y pueda revisar incidencias sin depender de notas externas.

## Gerencia

- Revisar el dashboard al inicio del dia: pedidos pendientes, facturacion, vencimientos de documentos y estado de taller.
- Mantener los datos de empresa completos: razon social, CIF, direccion, email de gerencia y datos bancarios.
- Crear usuarios desde `Usuarios y roles`, asignando rol y permisos por modulo.
- Usar perfiles por funcion: trafico, administrativo, contable, taller, chofer y visualizador.
- Revisar `Informes de gestion` semanalmente para detectar margen bajo, kilometros improductivos y clientes con rentabilidad irregular.
- Solicitar backups desde `Mi cuenta` cuando se necesite una copia extraordinaria.

## Trafico

- Crear pedidos desde `Pedidos`; usar pedido rapido solo cuando falten datos y marcarlo para completar despues.
- Asignar camion, remolque y chofer antes de enviar instrucciones.
- Si el viaje lo realiza un colaborador, informar precio acordado y email del colaborador.
- Enviar el flujo de colaborador para que confirme precio, matriculas, carga, descarga y albaranes.
- Revisar el cuadrante de trafico antes de cerrar el dia para comprobar que no quedan viajes sin asignar.
- Usar puntos de interes para empresas o direcciones habituales de carga y descarga.

## Administracion y facturacion

- Revisar pedidos entregados antes de facturar: albaranes, importes, cliente, referencia y ruta.
- No emitir facturas de pedidos incompletos o sin documentacion obligatoria.
- Controlar facturas pendientes de cobro y marcar cobros cuando proceda.
- Revisar datos fiscales de clientes antes de la primera factura.

## Taller

- Registrar incidencias de vehiculos en cuanto se detecten.
- Mantener fecha de ITV, seguro, tacografo y mantenimiento preventivo.
- Revisar alertas de documentos por vencer.
- Cerrar intervenciones solo cuando quede anotada la accion realizada y, si aplica, el coste.

## Chofer

- Entrar en la app de chofer con el usuario asignado.
- Abrir el viaje del dia y completar pasos: inicio/carga, carga OK, descarga, albaran y firma.
- Subir fotos de albaranes con buena luz y documento completo dentro del marco.
- Registrar incidencias en carga o descarga desde el boton de incidencia.
- Actualizar posicion GPS cuando sea necesario.
- Cerrar sesion al terminar si el dispositivo es compartido.

## Colaborador

- Abrir el enlace recibido por email.
- Confirmar precio acordado y matriculas antes de cargar.
- Usar el enlace de carga cuando el camion haya cargado.
- Usar el enlace de descarga para subir albaranes firmados y confirmar entrega.
- El colaborador solo ve su precio acordado, nunca el precio del cliente ni el margen interno.

## TransGestAdmin

- Revisar empresas activas, estado de facturacion, plan y vencimientos.
- Crear nuevas empresas y su usuario gerente.
- Bloquear una empresa solo por motivo justificado: impago, incidencia, baja solicitada o prueba finalizada.
- Usar backups para generar copias solicitadas por empresas.
- Revisar auditoria ante incidencias de soporte.

## Backups

- Configurar `PG_DUMP_BIN` en produccion para copias PostgreSQL restaurables.
- Si no existe `pg_dump`, el sistema genera una copia JSON de contingencia para no dejar solicitudes sin respuesta.
- Probar una descarga de backup tras cada despliegue importante.
- Guardar copias fuera del servidor en una ubicacion segura.

## Checklist diario

- Antes de empezar la jornada, ejecutar `cd transgest-backend && npm run daily:ready` contra el despliegue local o servidor configurado.
- Pedidos sin asignar: cero o justificados.
- Pedidos entregados sin albaran: revisar.
- Vehiculos con documentos por vencer: revisar.
- Incidencias abiertas: revisar responsable.
- Facturas pendientes de emitir: revisar.
- Backups pendientes solicitados: revisar desde TransGestAdmin.
- Si una pantalla muestra "Codigo de incidencia", descargar el JSON desde el boton de incidencia y adjuntarlo al aviso de soporte.
