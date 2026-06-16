# TransGest Contabilidad - Preguntas abiertas

Fecha: 2026-06-04

Estas preguntas deben resolverse antes de implementar o antes de activar cada bloque en produccion.

## Producto y alcance

1. TransGest Contabilidad sera modulo incluido por plan, add-on de pago o producto separado?
2. Debe estar disponible para todas las empresas o solo para empresas con plan profesional/enterprise?
3. Que nivel de autonomia tendra respecto a TransGest: misma marca y navegacion o app claramente separada?
4. Que usuarios externos deben acceder: asesores, auditores, clientes, proveedores?
5. Se necesita multiempresa contable consolidada para grupos o solo empresas independientes?

## Contabilidad

1. Que plan se ofrecera por defecto: PGC, PGC PYMES o decision guiada por asesor?
2. Hay asesoria contable/fiscal que valide plantillas de cuentas y mapeos?
3. Deben soportarse ejercicios partidos o solo ejercicios naturales?
4. Se requiere contabilidad analitica por vehiculo, ruta, cliente, chofer o centro de coste?
5. Que informes son imprescindibles para la primera version: Diario, Mayor, sumas y saldos, Balance, PyG?
6. Como se gestionaran asientos manuales frente a asientos automaticos?
7. Quien puede reabrir periodos y bajo que workflow de aprobacion?
8. Se requiere exportacion compatible con algun software de asesoria concreto?
9. Ya se permite editar borradores manuales antes de contabilizarlos o cancelarlos; queda por decidir si se exigira historial versionado visible o aprobacion adicional en produccion.
10. Que permisos y workflow avanzados deben exigirse para cancelar un borrador manual?
11. Ya existe borrador reverso tecnico para asientos contabilizados; queda por definir politica operativa exacta de aprobacion, fecha recomendada y casos rectificativos complejos.
12. Debe requerirse revision por una segunda persona antes de contabilizar asientos manuales por encima de un umbral?

## Facturacion fiscal

1. La facturacion actual de TransGest debe migrarse completa al servicio fiscal central o convivir temporalmente?
2. Que series de factura existen por empresa y cual es su politica de numeracion?
3. Hay facturas simplificadas o solo facturas completas?
4. Se emiten facturas rectificativas? Que casuisticas reales hay?
5. Se facturan operaciones intracomunitarias, exportaciones, inversion del sujeto pasivo o exenciones?
6. Que proveedor se quiere usar para VERI*FACTU: directo AEAT, Verifacti u otro?
7. Quien revisara los payloads fiscales antes de produccion?

## VERI*FACTU y SIF

1. Que empresas clientes estan obligadas y en que fecha exacta segun su forma juridica y actividad?
2. Se quiere operar en modalidad VERI*FACTU o mantener modo NO VERI*FACTU cuando proceda?
3. Quien asumira la declaracion responsable del productor del sistema?
4. Que proceso de versionado y release se usara para software fiscal?
5. Como se gestionaran certificados, claves y secretos por empresa?
6. Cuales son los requisitos exactos de QR, huella, encadenado y eventos segun la version normativa vigente?
7. Se necesita entorno de pruebas con AEAT/proveedor antes de piloto?

## Factura electronica B2B

1. Cuando debe incorporarse la factura electronica B2B en el roadmap real?
2. Que plataforma o red se usara para interoperabilidad?
3. Se requiere Facturae, formato europeo EN 16931 u otros formatos?
4. Que estados B2B deben reflejarse en Contabilidad?
5. Como se conciliara el estado B2B con cobros y reclamaciones?

## SII

1. Hay empresas obligadas a SII o sera solo adaptador opcional?
2. Debe incluir facturas recibidas, emitidas o ambas?
3. Se necesita compatibilidad con regimenes especiales?
4. Quien validara los libros registro y sus plazos?

## Datos, migracion y historico

1. Se deben generar asientos para facturas historicas ya emitidas?
2. Desde que fecha se activara Contabilidad para cada empresa?
3. Como se tratara una factura antigua sin datos suficientes para asiento completo?
4. Se migraran clientes/proveedores desde TransGest o se crearan como terceros contables separados?
5. Que documentos adjuntos se conservaran y donde?
6. Hay backups verificados antes de migrar?

## Seguridad, privacidad y auditoria

1. Se aceptara `localStorage` para la app contable o se migrara a cookie HttpOnly?
2. Se requiere MFA para perfiles contables, gerencia y asesoria?
3. Cual es la politica de retencion de logs, documentos y auditoria?
4. Quien puede exportar datos contables completos?
5. Se requiere segregacion de funciones: quien crea, revisa, aprueba y cierra?
6. Habra auditoria externa de seguridad o pentest antes de produccion?
7. Se requiere ENS, ISO 27001 u otro marco como objetivo comercial?

## Arquitectura y operaciones

1. Se prefiere BD separada o esquema separado para contabilidad en produccion?
2. Hay restricciones de hosting o backups por cliente?
3. Que cola se usara: PostgreSQL outbox inicial, Redis, RabbitMQ u otra?
4. Cual es el SLA esperado para procesamiento de eventos?
5. Que observabilidad se requiere: logs, metricas, trazas, alertas?
6. Como se gestionaran cambios de normativa: calendario, responsable y proceso de release?
7. Que ambientes existiran: local, staging, preproduccion fiscal, produccion?
8. Cuando deben publicarse los contratos internos como JSON Schema y que politica de compatibilidad/versionado se exigira?
9. Cuando se migrara `transgest_api` desde el superusuario PostgreSQL historico a un rol operativo sin acceso al esquema contable?
10. Cual sera el primer evento operativo piloto de la Entrega 1.1: empresa habilitada, pedido entregado u otro evento sin efecto contable?
11. Que fuente oficial, fecha efectiva y proceso de revision se usaran para versionar las plantillas PGC y PGC PYMES antes de importarlas?
12. Quien puede publicar o retirar futuras plantillas de sistema, y que workflow de doble revision se exigira?

## Decision antes de empezar

Minimo recomendado para iniciar implementacion:

- Confirmar monorepo inicial.
- Confirmar BD contable separada.
- Confirmar SSO one-time code.
- Confirmar que fiscal billing sera el unico emisor fiscal.
- Confirmar alcance de Entregas 0-3 como primer hito.
- Designar responsable de validacion contable/fiscal externa.
