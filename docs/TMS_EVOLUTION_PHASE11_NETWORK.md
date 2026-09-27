# Fase 11 — TransGest Network

Validación local: 27/09/2026. Rama aislada; sin envíos externos ni publicación.

## Comportamiento comprobado

- La coincidencia exacta de NIF/CIF sugiere una empresa elegible, nunca la conecta. Gerencia emite una invitación privada de siete días para un encargo con precio acordado; la otra gerencia revisa las condiciones congeladas y acepta o reduce los permisos.
- Permisos independientes para encargos, estados, matrículas/conductor, ETA, GPS, documentos, POD y muelles. GPS solo durante el servicio activo; ETA procede de un cálculo de carretera vigente para esa misma posición. Sin señal/cálculo no se inventan datos.
- Precio del transportista separado de la venta del cargador. La sincronización no renegocia precios; un cambio exige nueva aceptación expresa y no modifica viajes cerrados/facturados.
- Referencia externa, clave de operación, consentimiento versionado, registro de eventos, revocación bilateral y comprobación de identidad/plan actual en servidor. Revocar conserva lo recibido y corta la sincronización y las nuevas lecturas compartidas. Los códigos anteriores no reactivan la conexión.
- Albarán compartido y portal del proveedor entregan la última versión inmutable, con comprobación SHA, no una reconstrucción de la primera versión. Se corrigió además la instalación del rol colaborador, antes dependiente del seed demo opcional.

## Compatibilidad y límites

- Reutiliza conexiones y pares de viajes existentes. Las conexiones anteriores sin consentimiento explícito se conservan, pero requieren nueva invitación para compartir. La aceptación ordinaria del portal del colaborador continúa disponible; su token ya no autoriza por sí solo una conexión Network general.
- Facturación interna no se comparte: alcance reservado hasta disponer de un flujo y autorización apropiados. Tampoco se comparten costes internos ni nóminas.
- Listas acotadas: últimos 200 encargos/candidatos, 100 invitaciones/eventos; la sincronización procesa lotes. La interfaz indica estos límites. No es un buscador de todo el histórico.
- No se ha probado GPS físico, proveedor de carretera exterior, consentimiento de empresas reales ni correo real. La invitación se ofrece como enlace privado para compartir por el gerente; no se afirma un envío automático inexistente.

## Evidencia

- `node scripts/audit_workflows_regression_check.cjs`: salida 0, `schemaErrors: []`; 50 comprobaciones Network más regresiones previas. Empresas distintas, precio, permisos reducidos, documentos/GPS/POD, reintentos, sincronización sin cambios, revocación y auditoría. Archivo local `phase11-http-final.log`.
- `npm run check`: salida 0 (`phase11-check.log`). La comprobación HTTP final posterior incluye la migración del rol y el albarán actualizado.
- Frontend: 54 suites, 128 pruebas correctas; compilación correcta (`phase11-front-final.log`, `phase11-build-final.log`). Nueva prueba de revisión y aceptación explícita de permisos.
- Navegador con API y base sintéticas: carga y permisos visibles; 390 px sin desbordamiento del documento (382 px de contenido); formularios y casillas alineados. No datos de producción.

## Despliegue futuro

Aplicar `20260926_transgest_network.sql` antes del backend. No rellena consentimientos históricos. Comunicar la renovación de conexiones antiguas. Una reversión a la sincronización anterior permitiría un alcance excesivo: ante incidencia, desactivar la conexión y conservar la migración y su auditoría; no restituir el comportamiento previo de acceso amplio. No se ha desplegado.
