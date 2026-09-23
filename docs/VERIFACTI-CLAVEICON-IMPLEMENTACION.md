# Verifacti y ClaveiCon: implementación y validación

Fecha: 23 de septiembre de 2026. Rama: `codex/verifactu-clavei-flow`.

## Auditoría inicial

Se reutilizan `facturas`, los registros/envíos/eventos fiscales, el scheduler fiscal,
la revisión de facturas, el cifrado existente de integraciones y la ingesta del módulo
contable. No se modifica la contabilidad de ejercicios ni los exportadores de
CONTASOL/FACTUSOL y a3.

Los problemas encontrados antes de implementar fueron: creación fiscal sin clave
persistente de idempotencia; reencolado que podía reconstruir registros; QR interno
que no era el oficial; webhook sin contrato de firma/lotes/deduplicación; envío a
contabilidad antes de aceptación AEAT; y outbox interno que no constituía un transporte
real a ClaveiCon. El informe previo se comunicó antes de modificar el producto.

## Flujo implementado

1. Crear borrador y revisar referencias, importes y soportes. Si procede, guardar
   causa de exención/no sujeción o tipo y método de rectificación y volver a revisar.
2. Al emitir, comprobar NIF/entorno de la credencial de Verifacti mediante `health`.
   En producción se exige representación validada para ese NIF y declaración
   responsable publicada, con productor, versión y fecha. La verificación manual
   de representación se audita; no sustituye la firma ante Verifacti.
3. Persistir identidad, contenido y hash antes de la petición. La factura no pasa
   a emitida sin URL oficial del QR y su imagen. Ante respuesta perdida se consulta
   el registro; un UUID conocido nunca vuelve a llamar a `create`. Fuera de la
   ventana de idempotencia se bloquea el reenvío ambiguo y se requiere conciliación.
   Los registros antiguos sin identidad fiable tampoco se reenvían a ciegas.
4. Incluir QR tributario de 35 mm y leyenda en la primera página, tanto en impresión
   de la interfaz como en PDF por correo. Los borradores están identificados y no
   muestran QR. Conservar la identidad fiscal del emisor y cliente enviada al proveedor.
5. Recibir eventos de Verifacti mediante HMAC-SHA256 del cuerpo original,
   `X-Webhook-Signature` y `X-Webhook-Id`, correlacionando empresa/NIF/UUID. Guardar
   el aviso antes de responder 202. Procesarlo con el scheduler y consultar estados
   como respaldo. Un evento pendiente tardío no degrada un registro aceptado.
6. Recuperar aceptaciones confirmadas en una cola contable independiente después
   del commit fiscal. El fallo de contabilidad no revierte la aceptación de AEAT.
   Secuencia Clavei: cuenta → registro IVA → previsión; cada paso exige confirmar
   el anterior. El módulo contable interno sigue disponible mediante su ingesta.
7. En modo manual, descargar el XML, importarlo en Clavei y confirmar su referencia.
   Descargar no equivale a contabilizar. Un resultado desconocido bloquea otra
   exportación hasta verificar si se importó. Las comprobaciones de no importación
   y las importaciones confirmadas se auditan.

El XML oficial individual se recupera de `downloadXML` de Verifacti usando el UUID
de esta factura. El antiguo lote sintético deja de presentarse como XML oficial.
El resumen HTML de auditoría sigue disponible como documento interno.

## XML ClaveiCon

Contrato leído: **Intercambio XML.doc**, enero de 2020, y los cuatro XML de
**Ejemplos.zip** aportados por el usuario. Se implementan CUENTAS, FACTURAS/IVA y
PREVISIONES; no se ejecutan procedimientos ni se contacta con bases de datos de Clavei.

- Declaración ISO-8859-1; ROOT; atributos minúsculos, siempre entre comillas;
  campos documentados incluidos; vacíos numéricos 0 y textos vacíos.
- Entidades numéricas para caracteres superiores a ASCII 127; escape de XML;
  fechas `yyyy-mm-dd hh:mm:ss`; decimales con punto.
- `codemp` se conserva como texto, incluido `005`; ejercicio derivado de la fecha
  de factura, no del día de exportación. Vencimiento explícito.
- Cuentas estables de hasta 15 caracteres por empresa/tercero; posibilidad de
  asignar cuentas ya existentes antes de exportar. Sin derivarlas del orden del listado.
- `ivagenprev=0`: la previsión se exporta una sola vez como entidad separada.
  `ivagenast` configura el asiento generado desde IVA; no se envía otro asiento.
- Cuentas de IVA/retención se guardan en configuración. El contrato entregado no
  incluye atributos para forzarlas en FACTURAS: su correspondencia se configura en
  Clavei mediante sus operaciones/tipos, sin inventar atributos XML.
- El XML y su huella permanecen estables entre descargas. Un cambio que alteraría
  un fichero ya exportado exige conciliación. El importador manual de un tercero
  no permite garantizar que un usuario nunca vuelva a importar el mismo fichero;
  TransGest no marca un segundo envío automáticamente.

## Archivos y migración

Backend: `fiscal`, `fiscalProcessor`, `fiscalProviderVerifacti`, `fiscalQueueState`,
`fiscalEmission`, `fiscalIdentity`, `fiscalMetadata`, `fiscalRepresentation`,
`fiscalInvoiceSnapshot`, `fiscalQr`, `verifactiWebhook`, `fiscalScheduler`, `accountingSync`,
`accountingDelivery`, `claveicon/{xml,outbox,transport}`, `invoicePdf`,
`invoiceReview` y rutas de facturas, correo, webhook, Clavei y SuperAdmin.

Frontend: facturación, empresa, SuperAdmin; componentes `InvoiceFiscalData`,
`FiscalRepresentation`, `ClaveiconPanel`, `ClaveiconAdminSummary` y estilos comunes.

Migración **022_fiscal_accounting_delivery.sql**, aditiva e idempotente:

- amplía registros/envíos existentes con identidad, petición, UUID, QR y aceptación;
- añade metadatos fiscales a factura;
- añade bandeja persistente de webhooks, mapa de cuentas y outbox contable;
- no elimina ni renumera facturas ni fabrica aceptaciones.

El arranque asegura también este esquema mediante `fiscalSchema`. Antes de desplegar:
backup restaurable, aplicar migración, CI completa y comprobar el arranque. No volver
atrás borrando columnas/tablas con entregas fiscales; una reversión de código debe
conservar esos datos y detener envíos hasta conciliar cualquier resultado incierto.

No se añaden variables obligatorias de entorno. Se reutilizan:
`API_KEYS_ENCRYPTION_SECRET`, `FISCAL_SCHEDULER_ENABLED`,
`FISCAL_SCHEDULER_MINUTES`, `VERIFACTI_TIMEOUT_MS`,
`ACCOUNTING_API_URL` y `ACCOUNTING_INGEST_KEY`.
Credenciales Verifacti y secreto de webhook: configuración cifrada por empresa.
No se almacenan credenciales Clavei de una API cuyo contrato aún se desconoce.

## Verificaciones

Las pruebas usan PostgreSQL aislado/PGlite, respuestas remotas simuladas y HTTP
local. No se han registrado facturas reales ni enviado datos de clientes a AEAT/Clavei.

- Regresión fiscal: IVA 21/10/0, IRPF, exención, rectificación, migración repetida,
  identidad estable, respuesta perdida/consulta sin segundo alta, revisión previa,
  borrador bloqueado sin QR, HMAC real por HTTP, duplicados, NIF ajeno,
  eventos desordenados, persistencia de aceptación y recuperación contable.
- XML: ceros iniciales, año factura/vencimiento distinto, caracteres españoles,
  ventas positivas, abonos negativos con retención, referencia a la original,
  bloqueo de segundas descargas, dependencias y aislamiento de empresa.
- Interfaz: envío de metadatos como objeto, invalidación de revisión, bloqueo de
  edición fiscal, booleano `0` y conciliación de resultados desconocidos.
- PDF: texto/multipágina y render visual del QR en primera página, con recargo
  de combustible como concepto separado. Se conserva la prueba de salida al cliente
  sin contenidos internos de IA ni documentos ajenos.
- Suites generales, de seguridad, frontend y auditoría se ejecutan además de las
  nuevas pruebas. La compilación usa la misma política que CI: los avisos previos
  de ESLint se informan sin confundirlos con errores de compilación.

La aceptación en un entorno real de Verifacti y la importación en una instalación
de ClaveiCon requieren una prueba piloto con sus credenciales/configuración. Una
prueba simulada no certifica que esos servicios externos estén operativos.

## Resultado de las pruebas locales (23 de septiembre)

- Backend general: correcto (`npm run check`).
- Seguridad: correcto (`npm run security:regression`).
- Auditoría y facturación: correcto (`npm run audit:regression`).
- Frontend: 27 suites, 74 pruebas correctas; compilación de producción correcta.
- Tras la revisión final: repetidas las pruebas fiscales, PDF y salida al cliente;
  se comprueba también la conservación del PNG de Verifacti y de la identidad fiscal.
- No se ha desplegado ni enviado ninguna factura a servicios fiscales reales.
- Rechazos y aceptaciones con errores quedan bloqueados para contabilización:
  requieren revisión/subsanación con Verifacti y posterior consulta del estado.
  No se implementa un editor de subsanaciones fiscales ni se modifica el registro original.

## Respuesta de Clavei incorporada

Confirmación trasladada por el usuario en esta conversación:

- Los XML negativos corresponden a un abono. Las ventas normales se importan en
  positivo. Se conservan los signos de la factura y se elimina el selector de
  inversión global; los porcentajes de IVA/retención no se invierten.
- `ivafrarectifi` sigue `Ser/Eje/Fac` y debe coincidir con `ivaserieges`,
  `ivaejerges` e `ivanumfacges` de la original. Los tres campos se rellenan en cada
  factura a partir de su serie, ejercicio y secuencia. Ejemplo: `A-2026-0001`
  → `A`, `2026`, `1`; referencia del abono: `A/2026/1`.
- La rectificativa usa la identidad conservada en la cola de su original, dentro
  de la misma empresa, y exige que la importación original esté confirmada.
  Numeraciones ajenas al patrón de TransGest o series que excedan los dos
  caracteres admitidos por `ivaserieges` se bloquean sin truncar ni inventar datos.
- Clavei NO deduplica las importaciones. TransGest bloquea registros ya
  confirmados, pendientes de confirmación o con resultado desconocido. Una segunda
  descarga exige verificar y registrar que la primera no se importó. Esto no
  impide que un usuario copie e importe dos veces un archivo fuera de TransGest.
- Clavei dispone de consulta de asientos por fecha, cuenta y/o documento. Se
  utilizará para conciliar resultados cuando llegue el contrato de la API del
  cliente; todavía no se implementan ni suponen sus endpoints/respuestas.

La conexión se configurará únicamente para la empresa del cliente que dispone de
Clavei. No se activa ni se comparte su configuración con otras empresas.

## NECESITA CONFIRMACIÓN DEL PROVEEDOR

1. **Clavei: API**. Faltan URL, autenticación, operaciones, respuesta, consulta de
   duplicados e idempotencia. El manual documenta procedimientos SQL `ProcXMLCuentas`,
   `ProcXMLIVA` y `ProcXMLPrevisiones`, no un contrato HTTP. El modo API queda bloqueado.
2. **Clavei: configuración de la instalación**. Confirmar operaciones IVA,
   diario, concepto, usuario, bancos, tipos de previsión/retención y las opciones
   de importación de cuentas antes de cargar ficheros en la contabilidad real.
3. **GaunaSoftware**: aportar/publicar la declaración responsable real y validar
   la representación de cada NIF. No se ha redactado ni supuesto una declaración legal.

## Fuentes contrastadas

- [Verifacti: API fiscal](https://www.verifacti.com/docs).
- [Verifacti: NIF, representación y webhooks](https://www.verifacti.com/nifs-docs).
- [AEAT: QR, dimensiones y primera página](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/posibilidad-remision-informacion-factura-parte-receptor.html).
- [AEAT: preguntas para desarrolladores e IRPF](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf).
- Documentación Clavei suministrada por el usuario, leída como contrato de datos.
