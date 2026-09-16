# Correcciones de la auditoría de TransGest — 16/09/2026

Autorizadas tras el informe de 31 hallazgos y la mejora de acceso a Planner. Incluye las correcciones de seguridad de la PR #1. No se fusiona automáticamente ni se despliega sobre producción.

## Cambios y comprobaciones

| Hallazgo | Resultado implementado | Comprobación |
|---|---|---|
| A01 | SuperAdmin con contraseña débil obtiene una sesión restringida y debe cambiarla. Política fuerte, confirmación de contraseña actual e invalidación de tokens antiguos. | HTTP y SQL: acceso restringido, cambio, rechazo de sesión antigua y login nuevo. La contraseña real la debe elegir el administrador. |
| F01 | Borrador obligatorio; revisión explícita de importes, referencias y documentos, con usuario, fecha y huella del contenido. Justificación cuando la referencia no procede. Un cambio invalida la revisión. | Emisión sin revisión, sin documento o con contenido cambiado rechazada; revisión válida permite emitir. |
| F02 | Impresión, PDF, email y portal excluyen botones y datos internos de IA. Documentos del cliente limitados a pedidos vinculados y a su empresa. | PDF de 60 líneas, adjuntos y aislamiento por SQL; impresión del navegador. |
| F03 | Transiciones de factura controladas; no se puede volver una factura emitida a borrador. | Regresión HTTP y bloqueo concurrente. |
| F04 | Columnas numéricas estables, tabla con ancho mínimo, scroll y tarjetas móviles; corrección de grupos y singular. | Navegador, varios tamaños y temas. |
| F05–F06 | Reclamaciones solo de facturas emitidas y vencidas. Un fallo o simulación no incrementa envíos. | Rechazo SMTP, reintento, intervalo, doble clic, otro cliente y otra empresa. |
| F07 | Programador cada 15 minutos, activación explícita por empresa, intervalos y límites; registro por destinatario, exclusiones y bloqueo entre instancias. Entregas dudosas quedan para verificar, sin reenvío automático. | Configuración desactivada por defecto; pruebas de exclusión, envío confirmado, fallo, simulación, envío parcial y concurrencia. |
| F08 | Total facturado calculado en servidor sobre la base emitida del filtro completo, con rectificaciones, sin borradores ni límite de página. | SQL y controles de KPI financiero. |
| F09 | Evento de emisión únicamente en la primera emisión; otros estados tienen su propio evento. Se comunica a contabilidad el estado nuevo. | Transiciones y mismo estado idempotente. |
| C01 | Clientes en orden alfabético aunque se marquen revisados. | Consulta ordenada por nombre e ID; pruebas de clientes. |
| S01–S02 | Migración compatible de soporte histórico; conversación, respuestas, lectura/no leídos, errores y actualización visible cada 5 segundos. | SQL: migración sin perder mensaje/propietario, respuestas y privacidad. Navegador de soporte. |
| M01–M02 | Puerto 587 usa STARTTLS; 465 TLS directo. Diferencia entre configurado y envío verificado. Guardar cambios invalida la prueba anterior. | Contrato del transporte y SMTP local con autenticación/MIME/adjunto. No equivale a entrega en un buzón externo. |
| I01–I02 | Corregidos tipos SQL de la reserva de uso. Interfaz comercial sin marca de proveedor/modelo/origen de clave. | Reserva y respuesta; navegador web y Electron. |
| I03–I04 | HERE/ORS calculan una ruta en la prueba de conexión; GPS sin consulta remota indica evidencia de señal o pendiente. Configuración agrupada por capacidad y explicación del motor efectivo. | Peticiones y respuestas controladas, rechazo y respuesta vacía; configuración por empresa en navegador. |
| I05–I06 | Cuota cero desactiva IA, reserva atómica y devolución del consumo al fallar; disponibilidad visible y errores diferenciados. | SQL de reserva/devolución y aislamiento; sin llamadas facturables en estas regresiones. |
| D01–D03 | Importación resuelve clientes y asignaciones, maneja coma decimal y CSV con separador/comillas. Tarifas transaccionales y unicidad por ruta/cliente. | Importaciones reales en base aislada. Duplicados históricos detienen la migración sin borrarse. |
| T01 | Taller con control de versión y bloqueo transaccional; solicitudes no sobrescriben el estado. Entregas de material no aparecen guardadas si falla el servidor. | Dos lecturas y escrituras: la segunda edición obsoleta devuelve 409; conserva la primera. |
| T02–T03 | Posición de neumático exclusiva y cierre de jornada con parámetro SQL tipado. | Segundo neumático en misma posición rechazado; cierre válido y kilómetros inválidos comprobados. |
| Q01 | Orden de esquema corregido, migración versionada, errores de arranque contabilizados y /health responde 503 si no está listo. | Instalación aislada con todas las migraciones y actualización de soporte legado. |
| Q02 | Pruebas adaptadas a controles actuales; nuevas regresiones integradas en CI. | Backend, SQL, navegador, build, 15 suites/34 tests y Electron. |
| Q03 | Implantación comercial separada de estado técnico con fechas, error y pendiente de verificar. | Consulta real de DB/esquema y evidencia de pruebas, sin porcentaje comercial presentado como garantía técnica. |
| Q04 | Restauración real en PostgreSQL 17.11, manifiesto de versión/migraciones/checksum, JSON de contingencia consistente e identificado como datos sin esquema. | Dump y restore en bases nuevas: 83 tablas y 58 registros coincidentes. No es una restauración de la base de producción ni una prueba de cifrado. |
| Planner | Acceso visible “Gestionar / Planner”, productos independientes/combinados y aviso de guardado solo tras guardar. | Persistencia y permisos de producto; navegador y SQL. |

Los rótulos «Sin IA», «Analizar IA» y «Corregir pedido» sirven para revisar documentación y corregir datos antes de facturar. Son herramientas internas; no forman parte de la factura entregada al cliente.

Las rectificativas se crean como borrador y conservan el número, motivo y referencia a su factura original. Reutilizan su documentación para la revisión, mantienen los pedidos en la factura original y solo cambian su estado al emitir la rectificativa dentro de la misma transacción. Este recorrido tiene prueba HTTP y SQL específica.

Las facturas pendientes importadas se crean como borradores para revisión y conservan número/estado de origen como información. No se emiten ni reclaman automáticamente. Debe verificarse la numeración original al migrar saldos de otro ERP.

## Verificación reproducible

Backend: `npm run check`, `npm run daily-plan:regression`, `npm run security:regression`, `npm run audit:regression`, `node scripts/superadmin_security_check.cjs`.

Frontend: `npm test -- --watchAll=false --runInBand`, `npm run build` y los scripts de navegador de finanzas, pedidos, flota, almacén, taller, clientes, chófer, personal, portal, integraciones, soporte/proveedor, Intelligence y acceso a Planner. Estos scripts interceptan las API; se complementan con HTTP y SQL reales en las pruebas de backend. No sustituyen probar el proveedor externo de producción.

La prueba nativa `scripts/audit_workflows_regression_check.cjs` usa PostgreSQL local si se indican `AUDIT_PG_PORT`, `AUDIT_PG_PASSWORD_FILE`, `AUDIT_PG_BIN` y `AUDIT_BACKUP_DIR`. Solo acepta host 127.0.0.1 y crea dos bases nuevas con nombres aleatorios; nunca restaura sobre una base existente. Sin esas variables usa PGlite. Los archivos de resultados, claves, backups y logs no se suben al repositorio.

## Puesta en servicio y límites pendientes

1. Revisar los checks de la PR y fusionar cuando se autorice; respetar la protección de main. Backend y frontend deben publicarse desde el mismo commit.
2. Guardar una copia del destino y conservar las claves de cifrado actuales. Ejecutar `npm run migrate`. Si aparecen precios duplicados por ruta/cliente, resolverlos según el dato correcto; la migración no los elimina ni elige uno arbitrariamente.
3. El administrador debe cambiar su contraseña real al entrar. Las pruebas han usado únicamente credenciales desechables.
4. Probar SMTP hacia un buzón controlado y autorizado, Intelligence con la cuota real y las API contratadas. Aquí no se han enviado reclamaciones, correos o facturas a terceros.
5. Activar reclamaciones programadas solo en las empresas que deban enviarlas. Revisar destinatarios, plazo y máximos; los envíos con resultado incierto requieren comprobar su entrega antes de reintentarlos.
6. Q04 sigue pendiente de comprobación sobre una copia real de producción y de confirmar retención/almacenamiento cifrado/custodia de claves. El dump generado por esta versión no se cifra por la aplicación. El diseño de cifrado y sesiones continúa en `SECURITY_SESSIONS_BACKUPS_PROPOSAL.md`; no se anuncia como implementado.
7. Continúan los límites de seguridad anteriores ajenos a los 31 hallazgos: inventario real de planes antes de cambiar su fallback, migración de secretos fiscales históricos y pruebas de dispositivos/proveedores reales. No se ha generado un instalador EXE ni certificado producción.

Los avisos ESLint previos se mantienen; el build no presenta errores de compilación. La ausencia de errores en estas pruebas no garantiza ausencia absoluta de defectos.
