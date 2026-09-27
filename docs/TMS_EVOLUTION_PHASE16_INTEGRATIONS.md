# Fase 16 · Registro verificable de integraciones

Registro separado de las claves y del catálogo contable existente. Proveedores iniciales: HERE, ORS, Locatel, Tacogest, Movildata, ClaveiCon, Sage, A3, Holded, Wtransnet, Verifacti, AEAT, OpenAI, Anthropic, IA compatible y firma. Se pueden registrar futuros identificadores desde SuperAdmin. Ninguno se acredita automáticamente por existir código.

Estados: planned, development, sandbox_verified, pilot, production_ready y degraded. SuperAdmin muestra estado efectivo, salud, última prueba, error y versión API; historial de evidencias por ámbito, entorno y versión. Revisiones optimistas evitan pisar cambios. Rutas exclusivas SuperAdmin, no accesibles con tokens de empresa.

La promoción exige los nueve criterios: autenticación, roundtrip, idempotencia, reintentos, aislamiento, logs, monitorización, tests y healthcheck. Los ocho primeros requieren referencias verificadas y atestadas por SuperAdmin; se identifican como evidencia humana, no como ejecución automática. Salud solo procede de pruebas reales del servidor; no se puede declarar mediante el formulario. Caducidad: 24 h para salud, 30 días para evidencias; cambiar versión invalida su reutilización. La caducidad muestra degraded, sin cortar automáticamente operaciones. Prueba fallida o cambio de credenciales invalida la salud anterior. Las pruebas de sandbox no certifican producción ni una empresa acredita otra.

Se reutilizan botones «Probar» existentes. HERE v8, ORS v2 y Verifacti unversioned registran el entorno real. Proveedores cuya versión no se verifica quedan unspecified: no se promocionan por suponerla. AEAT directa no acredita conexión mediante validación de configuración. No se prueban proveedores externos en el banco sintético.

## Instalación y compatibilidad

Migración aditiva `20260927_integration_registry.sql`, antes del backend. Dos tablas nuevas e índice, sin modificar facturas ni contratos de claves. Sin DDL en ejecución. Reversión: volver al commit anterior conservando tablas para auditoría; no borrarlas. El registro no bloquea operaciones ya existentes ni cambia planes.

## Evidencia y límites

`audit_integration_registry.cjs` integrado en el banco HTTP: token ordinario rechazado, catálogo, promociones incompletas, salud falsificada, ámbito empresa/plataforma, entorno, versión, salud caducada/fallida, conflicto de revisión e invalidación. Todas las llamadas externas bloqueadas. Frontend: error visible al rechazar una promoción y evidencia accesible. Pilotos y contratos reales de proveedores continúan pendientes de validación externa. La evidencia humana no sustituye la revisión del acta citada. No se declara ninguna integración productiva en datos de clientes.

Resultados: banco HTTP completo código 0, schemaErrors vacío; `npm run check` código 0; frontend 57 suites/131 pruebas, build código 0 con avisos previos. La primera ejecución del nuevo test falló por faltar email_admin en una empresa sintética: se corrigió el fixture y se repitió. No se ha efectuado prueba visual del panel SuperAdmin en esta fase; interacción DOM comprobada con React y compilación.


## Ampliación del 27/09/2026

Fase 17 verificó visualmente Registro verificable en SuperAdmin a 390 px, con controles de 42 px, foco visible y los temas existentes. El banco HTTP del registro pasó también en PostgreSQL nativo. No se promovió ninguna integración real ni se introdujeron claves de cliente.
