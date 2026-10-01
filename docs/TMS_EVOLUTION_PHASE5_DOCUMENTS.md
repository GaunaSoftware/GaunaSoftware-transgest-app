# Fase 5 — originales de transporte y firma por operación

26/09/2026. Rama `codex/tms-evolution-phase0`. Implementación local, sin publicación ni cambios de datos reales. Esta fase no es la fase 5 del proyecto BI anterior.

## Implementación comprobada

- `transportDocumentVersions`: dos fuentes, TransGest o PDF externo. El externo conserva exactamente sus bytes; se comprueba formato, texto nativo declarado y máximo 5 MB, sin certificar su contenido. No se genera automáticamente otro DeCA sobre el original externo.
- Cada cambio material conserva payload, hashes, PDF, autor, motivo, fecha, versión, URL y token propios. Repetir una emisión idéntica devuelve la misma versión. Una sustitución requiere motivo. Triggers impiden actualizar o borrar originales y firmas.
- El QR nuevo descarga los bytes archivados, sin consultar y regenerar el pedido actual. Las notas internas y condiciones económicas no se incluyen en el PDF público. Se rechazan HTTP público, tokens incorrectos y accesos privados ajenos.
- Las firmas no cambian el DeCA. `LocalEvidenceSignatureProvider` prepara un justificante con su versión y hash, exige identidad y dos consentimientos, verifica que no haya cambiado, rechaza canvas vacío o PNG corrupto, registra evidencia y crea otro PDF firmado independiente. Reintentos tienen UUID estable; una anulación conserva la firma y un reemplazo queda relacionado.
- Se conserva contexto de pedido/viaje/parada, mercancía, participantes, conjunto, referencias documentales, reservas, GPS disponible o su ausencia, sesión, IP, agente y tiempo UTC. El justificante muestra matrículas/nombres disponibles; no utiliza UUID como matrícula ni inventa tiempos ausentes. La firma de perfil no se traslada al transporte.
- La app permite consultar el DeCA antes de terminar la carga. La nueva confirmación por parada comprueba en servidor que exista y se haya revisado la versión vigente antes de iniciar el transporte; un peso diferente exige revisar el documento. Posicionarse en carga no exige DeCA.
- La firma permanece abierta al actualizar Jornada en segundo plano. Errores y campos pendientes se muestran expresamente. El diálogo tiene acciones accesibles, altura limitada y gestión de foco/Escape.
- Pedidos incorpora identificación explícita de envíos nuevos por origen/destino y mercancía, validación de suma de pesos, UUID y auditoría; no sustituye la estructura de envíos ya documentados. Incluye selector de envío para emitir cada DeCA, historial, hashes, descarga, justificantes y anulación con motivo. El ZIP privado incluye todas las versiones, firmas, anulaciones, albaranes/fotos como anexos, eventos completos y manifiesto con hashes; no se limita a los eventos visibles. Límite explícito de 100 MB, sin truncado silencioso.
- Consolidación optativa en Mi empresa → documentación: por defecto desactivada. Admite varios envíos explícitos del mismo pedido, con las mismas partes, origen/destino/mercancía/peso individuales. El servidor impide mezclar modalidades documentales una vez emitidas y computa el peso una sola vez. Los envíos de distintos pedidos mantienen sus DeCA separados.
- Corrección de firmas cerradas: tráfico/gerencia pueden preparar un nuevo justificante a partir del snapshot de la firma anulada, revisar reservas e identidad y volver a firmar. No se reabre la operación física ni se reescriben sus tiempos, mercancía, documentos o participantes. La relación de sustitución evita corregir dos veces el mismo original.
- El expediente incluye `Preparacion/eCMR-borrador.json`, contrato `transgest.ecmr.preparation.v1`, reutilizando el exportador regulatorio sobre las versiones archivadas. Conserva partes, modificaciones, firmas, reservas, anexos y auditoría, con hash canónico. Define los siete estados futuros pero no interpreta eventos del transporte como aceptación eCMR ni habilita transiciones sin proveedor/procedimiento validado.
- Las observaciones internas de configuración se separan de un campo público específico del DeCA; las notas anteriores no se publican por defecto.

## Marco contrastado y límites jurídicos

Fuentes consultadas: [Orden FOM/2861/2012 consolidada](https://www.boe.es/buscar/act.php?id=BOE-A-2013-154) y [Resolución de 5 de junio de 2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-12784). Se retiró la exigencia informativa obsoleta de comunicar previamente el dominio y la firma avanzada como requisito general del documento administrativo. No se presenta la firma local de conformidad como AdES, QES ni firma certificada.

El PDF TransGest es nativo, tiene metadatos de creación/modificación y QR por versión. La apertura pública no caduca por una fecha planificada: la resolución permite desactivarla a los siete días de la finalización, pero la política posterior descrita en [DECA_ACCESS_AND_RETENTION.md](DECA_ACCESS_AND_RETENTION.md) mantiene el QR un año desde el fin real para que la otra parte pueda obtener el original. No se eliminan archivos automáticamente; deben conservarse como mínimo un año después de finalizar el transporte y nunca antes de `retention_until`. La conservación privada continúa aunque expire la consulta pública. TLS, recuperación de backups y acceso real desde inspección precisan validación del alojamiento.

## Compatibilidad y decisión de seguridad

El archivo legacy almacenaba una versión **privada**, mientras su URL pública regeneraba otro PDF. No existen bytes verificables de todas aquellas versiones públicas. No se inventa ese histórico ni se publica ahora el archivo privado: el enlace legacy devuelve 410 con explicación y el archivo se conserva para la empresa. Para servicios activos con ese enlace habrá que emitir explícitamente la versión administrativa nueva y distribuir su nuevo QR antes del despliegue. Esta transición es una condición de publicación, no una migración automática de documentos.

Las nuevas firmas necesitan `operation_id`, `document_hash`, identidad y consentimiento. Actualizar conjuntamente API, web y app Android; clientes antiguos recibirán validación explícita, no una firma aparente. No revertir a un backend que regenere documentos o sobrescriba firmas después de empezar a utilizar este modelo.

## Migraciones

1. Mantener aplicadas las migraciones operativas de fases 2–4.
2. Ejecutar `npm run migrate`, que incluye `20260926_transport_document_versions.sql`, `20260926_transport_signature_evidence.sql` y `20260926_transport_shipment_declarations.sql`.
3. Ensayar sobre copia aislada, repetir migraciones, verificar consulta privada/pública, historial, UUID repetido y rechazo de UPDATE/DELETE.
4. Los originales retenidos impedirán borrados en cascada que intenten destruirlos. Definir el procedimiento de conservación antes de eliminar una empresa; no quitar los triggers para hacer pasar un borrado.

No se añade DDL durante peticiones para estos modelos. El antiguo repositorio y sus inicializadores preexistentes continúan disponibles para lectura histórica.

## Evidencia ejecutada

Desde `transgest-bloque6-backend/transgest-backend`:

- `npm run check`: salida 0; incluye aislamiento, pedidos, operativa, BI, Planner y regresiones del chófer.
- `node scripts/transport_document_versions_check.cjs`: salida 0; PDF/bytes/hash/QR anterior, sustitución, fuente externa, campos, HTTPS, empresa, expiración real y revisión antes de salir.
- `node scripts/local_signature_evidence_check.cjs`: salida 0; identidad/consentimiento, imagen vacía/corrupta/dimensiones, GPS denegado, documento cambiado, replay/conflicto, permisos, inmutabilidad y anulación/reemplazo.
- `node scripts/transport_shipments_check.cjs`: salida 0; desglose explícito de 400/600 kg a dos destinatarios, rechazo de sumas/puntos incorrectos, dos PDF individuales, reintento, conflicto, aislamiento y cobertura documental de salida.
- `node scripts/audit_workflows_regression_check.cjs`: salida 0; PGlite con API HTTP real, `schemaErrors: []`, 83 comprobaciones HTTP de chófer/documentación y 19 de viaje compartido, además de los flujos previos. ZIP con más de 85 eventos y cotejo de todos sus hashes. Ninguna conexión o entrega externa.

Desde `transgest-frontend`:

- `CI=true npm test -- --watchAll=false --runInBand`: 44 suites y 118 pruebas aprobadas.
- Build con `CI=true`: fallo por advertencias preexistentes elevadas a error (dependencia dinámica, variables sin usar y hooks en otros módulos); no se ocultó como éxito.
- `CI=false npm run build`: salida 0 con esas advertencias. No equivale a un pipeline CI sin advertencias.

PDF sintéticos `output/pdf/phase5-deca-synthetic.pdf`, `phase5-consolidated-synthetic.pdf` y `phase5-receipt-synthetic.pdf`: renderizados y revisados, una página cada uno, tildes y texto legibles. Los trazos son una figura geométrica de ensayo, no una firma personal.

Navegador local con empresa sintética: anchos 390/768/1440/1920, sin desbordamiento horizontal del diálogo. A 390 px los dos botones secundarios comparten fila y confirmar ocupa otra; permanecen accesibles al desplazar el contenido. Tab/Shift+Tab contenidos en el diálogo, Escape y restauración de foco comprobados. Los datos del firmante permanecen tras más de dos minutos de refrescos de Jornada. Viewport restaurado. No equivale a Safari/iPhone ni Android físico.

## Pendiente de cierre completo

- Replanificación de envíos ya documentados/materializados: no reemplazarlos silenciosamente. La captura nueva cubre pedidos sin envíos/documentos previos; las correcciones de una estructura ya emitida necesitan workflow versionado propio.
- Cierre de carga posterior a su firma: el justificante conserva el tiempo existente al firmar; el fin posterior está en eventos, sin reescribir aquel PDF. Fotos se conservan como anexos identificados, no incrustadas en el justificante.
- Auditar los contratos legacy de cambios de estado y las salidas de Planner/colaboradores antes de extenderles el bloqueo documental. No afirmar que el nuevo control de la app cubre ya todas las vías de salida.
- La arquitectura eCMR es preparación interna versionada, sin proveedor ni ciclo contractual activado, tal como delimita la fase 5.11; no se considera certificado ni terminado.
- Concurrencia en PostgreSQL nativo, Android físico, conectividad/cámara/firma real y revisión profesional del procedimiento documental pendientes. PGlite y emulación no sustituyen esas pruebas.

No se declara terminada toda la fase ni listo para producción el conjunto de la evolución.


## Actualización de cierre local · 27/09/2026

Queda resuelto el pendiente de salida por colaborador: portal y enlace de correo antiguo consultan originales vigentes y exigen revisión explícita de sus IDs. Se rechazan versiones sustituidas, peso cambiado y salida global legacy sin parada. La salida por correo es transaccional y reintentable; conserva notas y un solo evento. No se inventa un original cuando falta.

La prueba visual encontró y corrigió JavaScript inválido en el portal, estados que confundían cargado con en ruta, encabezado obsoleto, contador impreciso y hover ilegible. El banco compila el script renderizado; HTTP comprueba formularios URL-encoded y llamadas simultáneas. Navegador 390/768/1440/1920, revisión del documento y salida comprobados.

`evolution-native-final.log`: PostgreSQL 17.11 local, migrador real aplicado/repetido, tres solicitudes simultáneas y un único evento/consumo de token, copia/restauración contrastada. Esta evidencia sustituye el pendiente genérico de PostgreSQL para esos casos concretos; no prueba fallos físicos ni todos los escritores concurrentes. Se conservan los límites de replanificación documentada, QR anteriores, dispositivo y revisión profesional. Ver `TMS_EVOLUTION_RELEASE_CHECKLIST.md`.
