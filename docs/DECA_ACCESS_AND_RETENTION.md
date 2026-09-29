# Acceso y conservación del DeCA

Normativa consultada el 29/09/2026:

- [Resolución de 5 de junio de 2026, apartados primero a tercero, quinto y séptimo](https://www.boe.es/buscar/act.php?id=BOE-A-2026-12784): el DeCA es un PDF digital nativo de hasta 5 MB, con QR que apunta a una URL HTTPS específica. La URL debe descargar el PDF directamente, sin autenticación ni botones. No puede expirar antes de finalizar el transporte; su descarga puede desactivarse **transcurridos siete días naturales desde la finalización**. Una modificación que genere un PDF nuevo exige un QR nuevo y conservar el fichero anterior.
- [Orden FOM/2861/2012, artículos 8 y 9](https://www.boe.es/buscar/act.php?id=BOE-A-2013-154): el transportista efectivo lleva el documento durante el envío; cargador contractual y transportista conservan ejemplar o copia a disposición de la Inspección **al menos un año**. La resolución de 2026 exige conservar los ficheros electrónicos generados durante ese plazo; si uno de los obligados los genera, el otro debe poder descargarlos durante un año.

Política técnica de TransGest:

1. El QR de un DeCA nuevo devuelve siempre el PDF de esa versión, sin regenerarlo con datos actuales del pedido. Durante el servicio y hasta que transcurran siete días completos desde su finalización real, una desactivación manual no puede impedir la descarga. En ausencia de fecha real de fin no se inicia la caducidad.
2. Los QR anteriores al versionado descargan los **bytes exactos** del PDF archivado. No se sustituye silenciosamente el fichero de una URL por otro distinto. Ese PDF antiguo puede incluir condiciones comerciales internas; por ello tráfico debe emitir y entregar un DeCA administrativo nuevo para los servicios que aún estén activos, y comprobar qué copia lleva el conductor. El enlace antiguo sigue disponible durante el mínimo legal para que el original impreso no abra una página de error en carretera.
3. Todos los ficheros originales y sus versiones se mantienen en el repositorio. La fecha `retention_until` existente en las versiones nuevas indica un mínimo calculado desde la emisión; **no autoriza un borrado** cuando el servicio termina después. Cualquier futura política de purga deberá calcular como mínimo un año desde el fin real y preservar los originales de cada versión. Actualmente no hay purga automática de `transport_document_versions`.
4. Si cambia el contenido durante el transporte, tráfico debe emitir y facilitar al conductor una versión nueva con su propio QR. El QR antiguo sirve para verificar ese archivo histórico; no sustituye la entrega de la versión vigente.

Validación sintética: `node scripts/transport_document_versions_check.cjs`. Comprueba descarga directa de los bytes originales, integridad, siete días desde el fin real, aislamiento de empresa y archivo conservado tras caducar el acceso público. No certifica el contenido de DeCA antiguos de producción que no se hayan inspeccionado.
