# Cuestionario para proveedor certificado eCMR / eFTI / DIWASS

Fecha: 2026-06-25

Usar este cuestionario en la primera reunion tecnica. El objetivo es confirmar si TransGest debe integrarse como sistema maestro TMS, como emisor de payloads o como cliente de una plataforma certificada.

## Identificacion del proveedor

- Nombre legal:
- Pais:
- Persona tecnica:
- Persona comercial:
- Plataforma o producto:
- Ambitos cubiertos: eCMR / eFTI / DIWASS / eAnnex VII / firma eIDAS.
- Certificaciones o conformidades disponibles:
- Documentacion tecnica disponible:
- Sandbox disponible:
- Plazo estimado de onboarding:

## Alta y contrato

1. Que requisitos hay para dar de alta a TransGest como integrador?
2. Que requisitos hay para dar de alta a una empresa cliente de TransGest?
3. Existe entorno sandbox con datos ficticios?
4. Hay proceso formal de homologacion tecnica?
5. Hay proceso formal de certificacion legal o solo integracion con plataforma ya certificada?
6. Que evidencias/documentos debe conservar TransGest?
7. Que evidencias/documentos conserva el proveedor?
8. Quien actua como responsable/encargado de tratamiento de datos?

## API y autenticacion

1. Tipo de autenticacion: OAuth2, mTLS, API key, JWT, firma de payload, otro.
2. Rotacion de credenciales y entorno por empresa.
3. IP allowlist o mTLS obligatorio.
4. Limites de tasa.
5. Idempotencia: cabecera o clave requerida.
6. Webhooks de estado y firma.
7. Reintentos y politica de errores.
8. Versionado de API.
9. Sandbox: endpoints, credenciales y escenarios soportados.

## Formatos y mapeo

1. Formatos soportados: JSON, XML, UBL, CMR propio, eFTI dataset, Annex VII digital.
2. Campos obligatorios por tipo de transporte.
3. Campos obligatorios para autoridades.
4. Campos obligatorios de partes legales.
5. Codigos de mercancia, embalaje, peso, unidades y referencias.
6. ADR: campos requeridos, ONU, clase, grupo embalaje, instrucciones, vehiculo/conductor.
7. DIWASS/eAnnex VII: codigo LER/residuo, productor, notificante, organizador, transportistas, instalacion, tratamiento, paises de transito.
8. Firma: firmantes requeridos, orden de firma, sello de tiempo y validacion de identidad.
9. Documentos adjuntos: albaranes, CMR, tickets de bascula, certificados, contratos.
10. Tamaño maximo de adjuntos y formatos admitidos.

## Estados

1. Estados de envio aceptados.
2. Estados de rechazo.
3. Estados de firma.
4. Estados de entrega/descarga/recepcion.
5. Estados DIWASS/eAnnex VII.
6. Estados de auditoria o inspeccion.
7. Como se corrige un payload enviado?
8. Como se versiona una modificacion posterior?
9. Como se anula un documento?
10. Que eventos deben sincronizarse de vuelta a TransGest?

## Certificacion y pruebas

1. Matriz oficial de pruebas.
2. Datos de prueba requeridos.
3. Casos negativos obligatorios.
4. Requisitos de logs.
5. Requisitos de retencion.
6. Requisitos de disponibilidad.
7. SLA de soporte.
8. Validacion de seguridad.
9. Pentest o revision externa necesaria.
10. Entregables finales para declarar integracion productiva.

## Decision tecnica esperada

Al cerrar la reunion se debe obtener:

- Estrategia elegida: proveedor certificado / certificacion propia / modelo mixto.
- Alcance inicial: eCMR, eFTI, DIWASS o firma.
- Formato canonico a implementar.
- Endpoints sandbox.
- Credenciales y responsable tecnico.
- Plan de pruebas con fechas.
- Criterios para pasar a produccion.
