# Fase 14 · Cola fiscal y contrato de proveedor

## Alcance local

Se conserva Verifacti como primer proveedor. `fiscalProviders` ofrece sendRecord, cancelRecord, getStatus y healthCheck; AEAT directo y SII devuelven no disponible. No hay fallback que presente una simulación como aceptación de producción. Se mantiene la simulación de pruebas anterior, identificada con `simulado`.

## Defectos reproducidos y corregidos

- Los errores definitivos tenían next_retry_at nulo y el selector los volvía a recoger. Ahora existe retryable explícito.
- La selección ignoraba estados aceptados y podía recuperar errores antiguos. Ahora toma el último envío de todos los estados y excluye registros aceptados.
- Reclamo atómico con SKIP LOCKED y arrendamiento de dos minutos, confirmado antes de la llamada HTTP. Scheduler y API ya no mantienen una transacción abierta durante la red.
- Clave de idempotencia estable por empresa/registro/operación. El primer intento se conserva. Sin UUID, pasadas 23 horas se exige conciliación; tampoco se reenvían ciegamente intentos legacy sin fecha conocida. La documentación del proveedor conserva claves durante 24 horas.
- El error de una consulta conserva el UUID ya conocido. Los reintentos consultan ese registro, sin crear otro.
- Las transiciones son transaccionales y una aceptación terminal no puede degradarse por respuesta tardía. Reencolar conserva fila, UUID, huella y payload; no vuelve a construir el original fiscal.
- Healthcheck real en /verifactu/health: exige estado OK, NIF y entorno coherentes. Un 400/404/422 ya no acredita autenticación. Conexión válida no equivale a aceptación AEAT.
- Estados desconocidos, incorrectos, duplicados y aceptados con errores requieren revisión; no se anuncian como aceptación limpia.
- Mapeo con fecha civil y bases/cuotas del documento emitido, sin perder suplementos ni multiplicar redondeos por línea. Las rectificativas nuevas conservan identidad original y tipo I/S. Los originales anteriores permanecen inalterados.
- Descargas XML identificadas como internas, no fichero oficial AEAT.

## Validación

`node scripts/audit_workflows_regression_check.cjs`: código 0, schemaErrors vacío; incluye `audit_fiscal_delivery.cjs` con clave estable, timeout, UUID conservado, error permanente, dos solicitudes concurrentes, terminalidad, inmutabilidad, reencolado, ventana caducada y empresa ajena. Toda red fiscal sustituida por respuestas sintéticas.

`npm run check`: código 0. `REACT_APP_LOCAL_SERVER=true CI=false npm run build`: código 0, con avisos de lint preexistentes. No se envió ninguna factura ni se modificó configuración real.

## Migración y compatibilidad

20260927_fiscal_delivery_guards.sql es aditiva; contempla instalación vacía del esquema fiscal existente. No cambia facturas, payloads ni huellas. Los errores legacy sin fecha de reintento pasan a revisión manual. Probar con copia aislada, dos workers y fallos de transporte. Ejecutar migraciones antes del nuevo servidor. Una reversión exige detener el scheduler antiguo: su selector no respeta retryable; no reactivar envíos automáticamente al volver atrás.

## Pendientes críticos

Piloto con NIF/entorno real, aceptación y consulta AEAT a través de Verifacti, rectificación y anulación acordadas con la clienta. Concurrencia entre procesos PostgreSQL nativos y reinicio a mitad de envío. Estos puntos no se certifican con PGlite. Las retenciones y documentos legacy rectificativos sin identidad/tipo completos se bloquean para revisión fiscal; no se inventa su tratamiento. Operaciones exentas, intracomunitarias o con regímenes especiales necesitan su clasificación fiscal real. El método de cancelación queda en el contrato, sin automatizar anulaciones jurídicas ni exponer un botón no validado.

Fuente primaria contrastada el 27/09/2026: [documentación Verifacti](https://www.verifacti.com/docs). El XML interno de TransGest y su huella propia no son una implementación del formato o encadenado oficial AEAT.
