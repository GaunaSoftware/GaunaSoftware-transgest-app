# Plan de pruebas para integracion/certificacion eFTI / eCMR / DIWASS

Fecha: 2026-06-25

Este plan debe ejecutarse antes de presentar TransGest a un proveedor certificado o auditor. Las pruebas funcionales internas no sustituyen las pruebas oficiales del proveedor.

## Entornos

| Entorno | Uso |
| --- | --- |
| Local | Validacion tecnica rapida |
| Preproduccion | Pruebas con datos ficticios y proveedor sandbox |
| Produccion `app.gauna.es` | Activacion controlada tras conformidad |

## Datos minimos de prueba

Crear o seleccionar pedidos con:

- Cliente con CIF/NIF, direccion, contacto y email.
- Colaborador o transportista efectivo con CIF/NIF, direccion, contacto y email.
- Chofer y vehiculo asignados.
- Origen/destino con direccion completa y pais.
- Fechas y ventanas de carga/descarga.
- Mercancia, peso y bultos.
- Documentos adjuntos: albaran, CMR/POD, ticket de bascula si aplica.
- Firma/evidencia si el caso lo requiere.

## Casos de prueba

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| TC-01 | Pedido nacional completo | DeCA/DCD listo, PDF archivado, QR/URL valido, payload eFTI preparado |
| TC-02 | Pedido nacional incompleto | Checklist marca faltantes y remision formal bloquea salvo gerencia |
| TC-03 | Pedido internacional | eCMR/eFTI con campos minimos, faltantes visibles si falta pais/partes/mercancia |
| TC-04 | Pedido ADR | Senal ADR, faltantes ONU/clase si no estan informados |
| TC-05 | Residuo no transfronterizo | DIWASS no aplicable o revision segun datos |
| TC-06 | Residuo transfronterizo | DIWASS/eAnnex VII requiere codigo residuo, actores, instalacion y paises de transito |
| TC-07 | Generar DeCA | `documento_control_repositorio` guarda PDF, hash y retencion |
| TC-08 | Exportar payload eFTI | JSON incluye schema, version, hash, validacion y audit |
| TC-09 | Exportar payload DIWASS | JSON incluye waste, actors, route y validation |
| TC-10 | Crear borrador transmision | Registro idempotente en `regulatory_transmissions` sin envio externo |
| TC-11 | DCD app chofer | Chofer ve DCD, puede abrir, imprimir, descargar, compartir y marcar revisado |
| TC-12 | Postfirma modificado | Remision formal exige confirmacion de gerencia |
| TC-13 | Link publico caducado/desactivado | Respuesta no expone documento y registra evento |
| TC-14 | Multiempresa | Usuario de otra empresa no accede a pedidos/documentos |
| TC-15 | Reintento proveedor sandbox | Misma idempotency key no duplica envio |

## Comandos internos recomendados

Desde `transgest-backend`:

```powershell
npm run check
npm run audit:tenant:strict
npm run functional
```

Desde `transgest-frontend`:

```powershell
npm run build
```

Para despliegue local con Docker:

```powershell
docker compose up -d --build
docker compose ps
```

## Evidencia que debe guardarse por caso

- Captura de pantalla.
- JSON exportado.
- PDF generado.
- Hash SHA-256.
- Usuario que ejecuta.
- Fecha/hora.
- Resultado.
- Incidencias.
- Decision: aprobado / bloqueado / pendiente proveedor.

## Criterios internos de salida

No enviar solicitud productiva si:

- Falla el aislamiento multiempresa.
- Hay payload sin hash o sin version.
- Falta DeCA/DCD para caso nacional.
- No se puede reproducir dossier regulatorio.
- No se puede trazar quien genero, exporto o remitio el documento.
- No hay respuesta clara sobre firma/eIDAS y proveedor certificado.

## Criterios externos de salida

Solo se puede marcar como integrado/certificado cuando el proveedor o auditor confirme por escrito:

- Formatos aceptados.
- Casos de prueba superados.
- Credenciales productivas activadas.
- SLA y soporte definidos.
- Evidencias legales requeridas.
- Procedimiento de correccion/anulacion/versionado.
- Responsabilidades de datos y conservacion.
