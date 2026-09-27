# Fase 17 — Multiempresa y análisis de grupo

27/09/2026. Rama aislada `codex/tms-evolution-phase0`. Pruebas exclusivamente sintéticas. Sin publicación ni escrituras en producción.

## Implementación

- `grupos_empresariales`, `grupo_empresas` y `usuario_empresas` permiten pertenecer a varias sociedades con rol, permisos, perfil y fichas vinculadas diferentes. La pertenencia a un grupo no concede acceso. Solo SuperAdmin administra grupos/membresías.
- Cada petición de usuario consulta la membresía activa, usuario global, empresa y permisos vigentes en servidor. El JWT identifica la sociedad solicitada, pero no concede su acceso ni determina su rol. Las rutas técnicas de API y soporte mantienen su autorización específica.
- Selector en la cabecera común y en las aplicaciones de rol: advierte de formularios pendientes, solicita una sesión de la sociedad autorizada, descarta la anterior y recarga la aplicación. Las respuestas de la sesión anterior no se aplican a la nueva. Colas offline permanecen separadas por usuario/empresa.
- Login elige una sociedad autorizada operativa si la principal está bloqueada; no elude el bloqueo de esa sociedad. Peticiones con sociedad explícita siguen validándose. El checkout conserva el ámbito de la membresía y comprueba revocación de contraseña.
- Agregado BI a demanda con periodo común y autorización expresa de gerente/contable en **todas** las sociedades, además de plan, producto y permisos. Revalida acceso al terminar. Suma métricas comunes y calcula ratios sobre sumas. No descarga el histórico completo al navegador.
- El agregado identifica cada sociedad, cobertura, corte y generación. No elimina operaciones entre sociedades y se denomina agregado de gestión, no cuentas consolidadas ni beneficio neto. No aplica filtros de cliente/vehículo de una sociedad a las otras. Kilómetros incompletos no producen un €/km aparentemente completo.
- Agenda, destinatarios de avisos, responsables Network y selección de gerentes del informe semanal consultan membresías. Antes de enviar el PDF semanal se vuelve a comprobar usuario, email, empresa, rol, permiso y plan.
- La caché incorpora empresa y revisión de membresía. Revocar acceso corta la sesión anterior y la consolidación. Un gerente no puede restablecer la clave ni modificar la identidad compartida desde Usuarios ni desde la creación/reset de usuario de Portal cliente. El usuario conserva el cambio de su propia clave.
- Grupos y accesos y Registro verificable reutilizan los temas de SuperAdmin, controles de al menos 40 px, foco visible y tablas desplazables. Se distingue carga, ausencia de grupos y error de acceso.

Facturación, fiscalidad, numeración, originales, operaciones y datos legales permanecen en su empresa. No se transfieren ni combinan documentos fiscales.

## Archivos y migración

- Servicios: `companyMembership.js`, `companyGroupBi.js`; middleware de autenticación/caché y adaptadores de auth, usuarios, clientes, agenda, choferes, informes, SuperAdmin, Network e informes semanales.
- Frontend: `CompanySwitcher`, `MultiCompanyAdmin`, `BiGroupPanel`, `AdminExtensions.css` y sus conexiones a Layout, SuperAdmin, BI y API.
- Migración aditiva `20260927_multiempresa.sql`, después de las migraciones anteriores, mediante `npm run migrate`. Backfill de una membresía por usuario actual; repetir no reactiva accesos revocados. El trigger conserva compatibilidad con altas y cambios de los escritores anteriores, pero no concede nuevas membresías durante un login o lectura. Un permiso JSON nulo se convierte en objeto vacío.
- La migración no fusiona empresas ni inventa grupos. Los originales y documentos históricos no se modifican.

## Evidencia y resultados

Backend, en `transgest-bloque6-backend/transgest-backend`:

- `npm run check`: código 0 (`phase17-release-check.log`). Incluye aislamiento, economía/BI, jornadas, pedidos, documentos y Planner.
- `npm run audit:regression`: código 0 (`phase17-release-audit.log`), banco HTTP real con PGlite, `passed:true`, `schemaErrors:[]`, sin correo ni conexiones exteriores.
- `node scripts/audit_workflows_regression_check.cjs`: código 0 (`phase17-security-http.log`). Casos nuevos: dos sociedades, roles diferentes, token con empresa/rol inventados, revocación, replay de migración, cambios de identidad compartida rechazados, reset del portal rechazado, login con empresa principal bloqueada, permiso JSON nulo, coste/km sin cobertura, caché por empresa/revisión. El grupo de referencia suma 2.100 € de ingreso, 650 € de margen y 1.500 km: 1,40 €/km.
- `node scripts/bi_weekly_check.cjs`: código 0 después de adaptar su esquema sintético a las membresías.

Frontend, en `transgest-bloque6-backend/transgest-frontend`:

- `CI=true npm test -- --watchAll=false --runInBand`: **60 suites / 134 pruebas aprobadas** (`phase17-release-tests.log`). Incluye conflicto de edición de permisos sin perder sociedad/revisión, permiso heredado nulo, cambio de empresa y error de autorización del BI de grupo.
- `CI=false REACT_APP_LOCAL_SERVER=true npm run build`: código 0 (`phase17-release-build.log`). Persisten advertencias ESLint/dependencia dinámica anteriores. Es compilación para el banco local, no una publicación.
- `git diff --check`: código 0.

Fallos durante el desarrollo: consulta de auditoría con parámetro UUID/texto incompatible, alias SQL faltante en listado de usuarios y texto del test escrito con codificación Windows. Se corrigieron y repitieron las pruebas. Un primer caso sintético usaba SQL NULL donde el esquema exige NOT NULL; se corrigió para probar JSON null, que sí es una entrada existente posible.

Navegador local: login, confirmación de cambio de A/gerente a B/contable, ausencia de pedidos de A en B, navegación a informes y cálculo de grupo. El mes sintético mostrado concilia 3.369 + 600 = 3.969 €; costes 1.350 + 200 = 1.550 €; margen 2.419 €. La sociedad con distancias incompletas muestra «No calculable». Tab desde selector de grupo llega a Consultar. BI sin desbordamiento global a 390/768/1440/1920. Formularios de SuperAdmin comprobados a 390 px con controles de 42 px y foco visible; registro de integraciones sin estados de éxito ficticios. Vista restaurada. No equivale a Safari/iPhone ni teléfono físico.

## QA y límites antes de publicar

1. Ensayar migración y repetición en PostgreSQL nativo sobre copia restringida. Comprobar conteo de membresías iniciales y que usuarios inactivos no obtienen sesión.
2. Crear un grupo de dos empresas de ensayo. Añadir el mismo usuario como gerente y contable; limitar Nóminas en una. Verificar selección, rutas directas, exportaciones y revocación durante una sesión.
3. Dar BI de grupo en ambas, comprobar sumas y retirarlo en una: el grupo completo debe dejar de estar disponible. Comparar detalle de cada sociedad con igual periodo.
4. Comprobar app móvil y colas offline al cambiar empresa, así como correo semanal con proveedor real autorizado. No se ha enviado correo real en esta fase.
5. La lectura BI es por sociedad durante la generación, no una instantánea transaccional única del grupo; se declara en el resultado. Falta medición de rendimiento con grupos grandes en PostgreSQL real.

Despliegue, no ejecutado: copia completa restaurable y ensayada, migraciones antes de API, después web/app compatibles, smoke de usuario de una empresa y usuario multiempresa. No mezclar servidores antiguos/nuevos durante la activación. Para revertir a un backend anterior a membresías, **invalidar todos los JWT de usuario y exigir login**, pues el código anterior usa la empresa principal del usuario. Conservar las tablas/evidencias; no aplicar down migrations destructivas. El selector y los accesos secundarios dejan de existir con el código anterior.

La fase está implementada y validada localmente. No certifica por sí sola la publicación de toda la evolución.


## Ampliación de evidencia · PostgreSQL nativo

El 27/09/2026 se ejecutó el banco HTTP completo en PostgreSQL 17.11 local sobre bases nuevas sintéticas. El runner real aplica 61 migraciones y su repetición conserva IDs/checksums/fechas; membresías, roles, revocación, caché e aislamiento pasan. `pg_dump`/`pg_restore` contrastan 184 tablas y 670 filas. Registro local: `evolution-native-final.log` y `output/native-pg-backups/restore-verification.json` desde la raíz del worktree.

La prueba descubrió y corrigió el orden de migraciones dependiente del idioma y la conversión de SQL DATE a día anterior. No se modificó ningún SQL histórico ni ninguna fecha guardada. Esta evidencia sustituye la falta de prueba PostgreSQL del banco sintético; sigue pendiente el ensayo con copia autorizada de instalación real, grupos grandes y móvil físico. Véase el checklist de cierre para publicación y reversión.
