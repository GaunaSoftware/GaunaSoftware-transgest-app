# TransGest Planner

Version independiente para fabricantes/cargadores que encargan transportes a agencias.
No convierte a sus usuarios en agencias ni comparte automaticamente datos con el TMS.

## Implementado

- Aplicacion y compilacion diferenciadas, conservando el logo.
- Lista paginada mensual de cargas, destinatarios, agencias, documentos y empresa.
- Crear/editar cargas, varias recogidas y entregas ordenadas, referencias y ventanas.
- Asignar agencia externa, tarifa por viaje o tonelada independiente del precio de venta.
- Envio explicito del encargo a la agencia mediante el flujo existente de confirmacion,
  carga, trayecto, descarga y albaranes. Requiere correo configurado y acceso a Internet.
- Permisos existentes y aislamiento por empresa en la API compartida.
- API configurada como Planner bloquea asignaciones de flota propia y sus modulos.
- La interfaz verifica el producto del servidor: no opera contra un TMS por error.

## Despliegue independiente

Reutiliza el codigo del backend, no su base de datos ni sus claves de produccion.
Crear un fichero de entorno distinto, con las mismas variables de deploy/local/README.md,
otra URL/puerto (por ejemplo 8090), y secretos nuevos. No reutilizar .env del TMS.

Desde deploy/local:

```powershell
docker compose --env-file .env.planner -f compose.yml -f planner.compose.yml build
docker compose --env-file .env.planner -f compose.yml -f planner.compose.yml up -d --wait
```

El nombre de proyecto distinto mantiene separados los volumenes PostgreSQL y backups.
Crear el administrador mediante el mismo script del backend dentro de este proyecto.
En hosting: backend con TRANSGEST_PRODUCT=planner y frontend con
REACT_APP_PRODUCT=planner; configurar expresamente su API/URL, CORS y base de datos.
El build local `npm run planner:build` genera build-planner y usa API bajo el mismo dominio.

## Reutilizacion y limites de esta primera version

Reutilizados: autenticacion/permisos, empresas, destinatarios, agencias, cargas,
documentos, confirmacion del transportista, tarifas de proveedor, avisos del servidor.
Excluidos de la navegacion: taller, flota, conductores propios, nominas, tacografo,
rentabilidad de camiones y facturacion de venta del transporte.

Pendiente para una edicion comercial completa: turnos/muelles con capacidad,
licitaciones y comparacion de ofertas, contratacion por cupos, indicadores de compras
de transporte y un portal de agencias especifico. Los catalogos administrativos
reutilizados aun conservan parte del vocabulario del TMS.

Asignar una agencia no crea un viaje en otra instalacion de TransGest: esa conexion
requiere vinculacion y consentimiento entre empresas, contrato de API e idempotencia.
No se ha habilitado una copia silenciosa entre bases de datos.
No esta publicado ni validado con datos reales de una fabrica.
