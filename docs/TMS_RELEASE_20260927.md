# Publicación solicitada · 27/09/2026

El usuario autoriza pruebas y despliegue de la evolución acumulada hasta fase 17 y estas correcciones. Sustituye la restricción de publicación de los informes locales anteriores; sus límites externos siguen vigentes.

## Defectos reproducidos y corregidos

- Agenda: asignaciones a proveedor aparecían sin asignar al buscar solo tractora/conductor propios. Ahora usa el adaptador común e incluye el proveedor.
- Gastos de estructura: el flujo antiguo dependía del resumen BI completo y las tablas solo estaban en el SQL manual de localStorage. El migrador oficial dejaba el alta con error 500 por tabla ausente. Se incorpora `20260927_structure_expenses.sql`, endpoint mensual independiente, recurrencia mensual y puntual, reparto por camión igualitario o según ingresos netos, cierre/reapertura y justificantes persistidos. Cálculo compartido con BI, céntimos reconciliados y saldo no atribuido visible. No genera costes duplicados ni modifica facturas.
- Tutoriales desactivados globalmente: arranque, eventos/manuales y pedidos. Se conservan preferencias y avisos operativos de tareas.
- HERE: cambiar criterio no recalculaba; respuestas atrasadas o guardadas podían conservar otra geometría. Ahora la clave incluye pedido, paradas, coordenadas, criterio y dimensiones. Se descartan respuestas antiguas, se informa de errores y se usan parámetros `vehicle[...]` actuales. Una respuesta sin geometría no se acepta como ruta válida.
- Gastos en móvil: controles ajustables, desplazamiento propio de tabla, reparto en una columna y círculo visible cuando un único camión recibe el 100 %.

## Pruebas ejecutadas

Desde `transgest-bloque6-backend/transgest-backend`:

- `npm run check`: código 0. Incluye HERE, gastos, BI, documentos, chófer, Planner, fiscalidad, integraciones y multiempresa.
- `npm run security:regression`: código 0.
- `node scripts/audit_workflows_regression_check.cjs` con `AUDIT_PG_*` y PostgreSQL local aislado: código 0. Migrador real: 62 SQL y repetición sin alteraciones. HTTP de gastos: altas mensual/puntual, reparto, mes siguiente, aislamiento, cierre, edición bloqueada, reapertura y adjunto persistido. También pedidos, cobros, documentos, viajes y permisos.
- Copia/restauración del banco local: 186 tablas / 673 filas. SHA-256 `56394660e767224ee8194e9f62ccb62c034c5e487d683ecf2b2573cffff9780d`.

Desde `transgest-bloque6-backend/transgest-frontend`:

- `CI=true npm test -- --watchAll=false --runInBand`: 62 suites / 140 pruebas correctas.
- Tras el ajuste visual: `npm test -- --watchAll=false --runInBand GastosEstructura LiveOperations useOptimizedRoute`: 3 suites / 9 pruebas correctas.
- `npm run build`: código 0, advertencias ESLint existentes. `CI=false`, sourcemaps desactivados y dos trabajadores mediante helper local no publicado. Un primer intento sin límite se detuvo; no se considera superado. Un primer backend check encontró EPERM de procesos en sandbox; repetición autorizada completa: código 0.
- Navegador con datos sintéticos: inicio sin tutorial, alta mensual 100 €, persistencia y reparto de 100 € en una tractora. Comprobación visual móvil 390 px con controles accesibles.

## Evidencia previa real

- API inicial: `f4ef3daa833d072590ca09c6b9f7c3bf9118915d`.
- Copia completa: `transgest_backup_2026-09-27_10-37-47-658.dump`, 100.951.744 bytes; SHA-256 `8714e6dd6cc00f0b03adde8e748e82975de5168537fdd434602e661d5b22b17b`.
- Restauración aislada con `pg_restore --exit-on-error`: código 0, 155 tablas / 15.915 filas. Base restaurada conservada sin aplicación ni tareas conectadas, independiente del contenedor API. No se mutaron los documentos ni viajes originales.
- Consulta previa del repositorio documental: cero documentos activos. No acredita documentos externos no registrados.
- HERE real con coordenadas públicas, sin direcciones de clientes: Madrid–Valencia HTTP 200 / 404,840 km; Madrid–Barcelona HTTP 200 / 631,248 km; geometrías distintas. No se imprime la clave. Criterios distintos pueden devolver legítimamente el mismo itinerario.

## Publicación y reversión

Antes de fusionar: diff, CI y ensayo de migraciones sobre copia restaurada. Render tiene `npm run migrate` como predeploy y `/health`. Verificar versión efectiva en API y frontend. No activar por esta publicación proveedores, cobros ni integraciones externas sin configuración.

Si falla predeploy, conservar la versión activa, sin forzar checksums ni hacer migraciones destructivas. Para revertir después de publicar, detener consumidores nuevos y conservar originales/evidencias. Seguir `TMS_EVOLUTION_RELEASE_CHECKLIST.md`: backend anterior a membresías exige invalidar JWT; no reactivar workers fiscales antiguos que ignoren `retryable`. La copia no sustituye automáticamente operaciones posteriores a su hora de corte.

Android físico/Play/Firebase, pilotos fiscales/inbound, eCMR contractual y automatismos WMS avanzados conservan sus límites. La publicación web/API no certifica esos puntos ni riesgo cero.

Estado: pendiente CI, ensayo final sobre copia y verificación de despliegue.
