# Estado de implementacion - 10 septiembre 2026

## Operativa comprobada

- Mesa de trafico > Plan diario: varios pedidos por conjunto, orden persistido
  de pedidos y descargas numeradas; envio de un plan completo a la app del chofer
  y el mismo orden en el texto preparado para WhatsApp.
- La asignacion por arrastre no modifica fecha ni precio. El aviso de taller
  no se superpone con el estado sin trabajo.
- Rutas: calculo estimado por tonelada con minimo de ruta, minimo del cliente o
  24 t por defecto. Se muestran toneladas usadas y EUR/km; no es margen real
  contable. Sin coste especifico se usa la referencia estimada de 0,42 EUR/km;
  no representa el coste completo real de una empresa.
- Clientes: minimo facturable en toneladas editable con coma decimal.
- Documentos del chofer: lectura y subida por conductor vinculado; acceso por
  vehiculo solo si el pedido no tiene otro conductor asignado. No se concede
  acceso por coincidencia de nombre. Vincular usuarios a su ficha de chofer.
- Permisos: se respetan revocaciones sin conceder permisos de oficina a roles
  restringidos. Probados perfiles de oficina, cliente, chofer y solo lectura.
- Orden de carga para colaboradores: bloqueo de flota propia en UI y servidor,
  incluida matricula manual coincidente. Precio proveedor por tonelada separado
  del precio de venta por viaje, sin mostrar un total cerrado en esa orden.
- Confirmacion transaccional para sacar un vehiculo del taller al asignar.

## Productos y escritorio

- TransGest Go, Control, Pro y Pro Intelligence conservan sus identificadores
  internos de licencia. No se cambian contratos o precios de suscripcion.
- Intelligence: chatbot de consulta con herramientas acotadas, permisos y empresa
  derivados de la sesion. Sin acciones de escritura ni llamadas reales en QA.
- Planner: primera version independiente para cargadores que asignan agencias.
  Ver TRANSGEST_PLANNER.md para despliegue y alcance pendiente de producto.
- Ejecutable portable Windows generado y probado. Debe conservar todos los
  archivos del ZIP, no mover solo el .exe. No contiene QA ni archivos .env.
- Servidor LAN con PostgreSQL y scripts de backup/exportacion offline preparados.
  Ver deploy/local/README.md. No se migra ni sincroniza produccion automaticamente.

## Verificacion

Frontend: compilaciones TMS/Planner, 14 pruebas unitarias, pruebas de navegador
para plan diario/tarifas, Planner, operativa y chatbot; ejecucion del .exe con API
simulada. Dos avisos de hooks preexistentes en GestionTrafico y MiCuenta.

Backend: check general, regresiones de operativa/SQL, informes, integraciones,
Intelligence, permisos, documentos del chofer, proveedor y esquema local nuevo.
Los mocks no prueban entrega real de notificaciones, correo, GPS ni respuesta IA.

## Pendiente que no debe darse por completado

- Arranque integral LAN, reinicio, restauracion y corte de Internet en un equipo
  con motor Docker disponible. En este equipo no hay motor Docker arrancado.
- Pruebas reales de OpenAI/GPS/correo con autorizacion y configuracion de empresa.
- Publicacion independiente de Planner y validacion con usuarios de una fabrica.
- Funciones comerciales adicionales de Planner descritas en su documento;
  no se han simulado licitaciones, cupos ni conexion entre instalaciones.
- Confirmacion del despliegue remoto del commit, aparte del push a GitHub.
- Siguiente bloque acordado con el usuario: trabajar en la app del chofer.
