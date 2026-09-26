# Evolución integral controlada de TransGest

Actualización: 26/09/2026. Documento de continuidad; no sustituye ni sobrescribe los inventarios y evidencias de cada fase. El encargo comprende **fases 0–17 de TMS**, distintas de las antiguas fases BI.

## Reglas que continúan vigentes

- Trabajar en la rama aislada `codex/tms-evolution-phase0`, conservando cambios ajenos. Commits separados y verificables.
- Sin push, merge, publicación ni cambios en producción para esta evolución sin autorización específica.
- Reutilizar stack, servicios, navegación, identidad y contratos existentes. Migraciones aditivas versionadas; no añadir DDL en ejecución para estos modelos.
- Aislamiento por empresa, rol y plan en servidor. Operaciones críticas idempotentes y auditables. Datos sintéticos solo en el banco local identificado.
- No inventar históricos, costes, mercancías, horarios reales, direcciones jurídicas, firmas ni estados de certificación. Conservar originales fiscales/documentales.
- No avanzar a implementación de la siguiente fase con pruebas de la anterior fallando. Probar comportamiento además de compilación; consignar límites reales.
- El conjunto de la evolución no está listo para publicar mientras queden validaciones críticas y límites de las fases previas.

## Estado y orden de continuación

| Fase | Estado en esta rama | Evidencia / pendiente |
| --- | --- | --- |
| 0 Auditoría | Inventario realizado | `TMS_EVOLUTION_PHASE0_AUDIT.md`; hipótesis contrastadas posteriormente |
| 1 Correcciones inmediatas | Correcciones y regresiones probadas; límites explícitos conservados | `TMS_EVOLUTION_PHASE1_PROGRESS.md` |
| 2 Modelo operativo | Base aditiva y adaptador probados | `TMS_EVOLUTION_PHASE2_MODEL.md`; pendiente identificar explícitamente envíos múltiples, no inferirlos |
| 3 Mesa de tráfico/grupajes | Primera integración funcional probada | `TMS_EVOLUTION_PHASE3_TRAFFIC.md`; mantener sus límites, especialmente replanificación, carretera real, costes y concurrencia |
| 4 Chófer multiparada | Integración de viajes materializados probada | `TMS_EVOLUTION_PHASE4_DRIVER.md`; legacy preservado, Android/dispositivo pendiente |
| 5 DeCA/carta de porte/expediente | Núcleo implementado y probado; límites de cierre documentados | `TMS_EVOLUTION_PHASE5_DOCUMENTS.md`: originales inmutables, envíos explícitos/consolidación optativa, correcciones de firmas abiertas/cerradas, ZIP, contrato eCMR preparatorio y app. Restan transición legacy, vías de salida anteriores y validaciones externas |
| 6 Tracking/ETA/geofencing | Implementación local y regresiones verificadas; integración exterior pendiente | `TMS_EVOLUTION_PHASE6_TRACKING.md`: captura verificada, señal obsoleta, ETA por carretera a demanda, geocercas auditadas y permisos. Planner sujeto al consentimiento de fases 10–11; dispositivo/proveedor real pendiente |
| 7 Android/Play Store | Implementado y compilado localmente; publicación no habilitada | `TMS_EVOLUTION_PHASE7_ANDROID.md`: FGS autorizado, push condicionado a Firebase, copias PDF privadas, deep links, diagnóstico y CI. AAB sin firma; faltan teléfono, Firebase real, política legal alojada y pista interna |
| 8 Bandeja IA | Implementada y verificada localmente; correo externo condicionado | `TMS_EVOLUTION_PHASE8_AI_INBOX.md`: originales privados, deduplicación, estados, revisión humana y creación idempotente; falta configurar/verificar dominio y proveedor inbound real |
| 9 Importador 2.0 | Pendiente de contrastar e implementar | Reutilizar importador existente; sin tratamiento exclusivo de TLM ni efectos sobre históricos |
| 10 Planner | Pendiente de contrastar e implementar | Separación de empresa transportista, stock y coste auditables |
| 11 Network | Pendiente de contrastar e implementar | Intercambio expresamente autorizado y aislamiento de empresas |
| 12 Facturas proveedor e IA | Pendiente de contrastar e implementar | Revisión y conciliación; no pagos automáticos |
| 13 Facturación operativa | Pendiente de contrastar e implementar | Reutilizar reglas de revisión, facturación parcial y línea de combustible |
| 14 Fiscalidad | Pendiente de contrastar y validar | Reutilizar integración fiscal; pruebas reales dependientes del proveedor |
| 15 KPI/BI | Pendiente de conciliación del nuevo modelo | Sin duplicar kilómetros físicos ni costes; incorporar/anular costes de viaje con conciliación explícita |
| 16 Integration Registry | Pendiente de contrastar e implementar | Contratos y capacidades reales de proveedores |
| 17 Multiempresa | Pendiente de contrastar e implementar | Membresías, permisos y autorización efectiva; no confiar solo en parámetros o JWT |

Antes de dar una fase por terminada, revisar todos sus requisitos del encargo original y resolver o identificar expresamente cada límite heredado. Los documentos 0–5 constituyen evidencia de lo realizado, no una certificación global. El usuario ha autorizado terminar las fases pendientes; no hay que pedir permiso otra vez para implementar. Continuar por los pendientes de fase 5 antes de declarar su cierre; no presentar como terminadas las fases 6–17 por existir módulos anteriores.
