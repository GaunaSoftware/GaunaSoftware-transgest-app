# Profesionalizacion de TransGest

Este documento sirve como hoja de ruta tecnica para llevar TransGest a un nivel profesional y mantenible.

## Prioridad 1 - Estabilidad operativa

- Evitar pantallas blancas con `ErrorBoundary` global.
- Unificar errores de API para que el usuario no vea mensajes SQL o `failed to fetch`.
- Asegurar que pedidos, facturacion, colaboradores y documentos no dependan de datos solo en `localStorage`.
- Mantener backend y frontend con build limpio antes de entregar cambios.

## Prioridad 2 - Seguridad y permisos

- Mantener tokens publicos de colaborador con hash, caducidad y un solo uso.
- Limitar por rate limit los endpoints publicos y de login.
- Revisar todos los endpoints multiempresa para garantizar aislamiento por `empresa_id`.
- Exigir `JWT_SECRET`, SMTP, Stripe y CORS bien configurados en produccion.
- Registrar acciones criticas: login, impersonacion, bloqueo de empresa, facturas, backups, borrados y exportaciones.

## Prioridad 3 - Base de datos y migraciones

- Consolidar las migraciones actuales en scripts versionados y repetibles.
- Reducir los `ALTER TABLE ... catch(() => {})` como estrategia permanente.
- Crear un comando unico de despliegue que aplique migraciones, compruebe salud y arranque servicios.
- Crear indices para consultas frecuentes de pedidos, facturas, vehiculos, documentos y alertas.

## Prioridad 4 - Experiencia de usuario

- Sustituir alertas nativas por notificaciones internas consistentes.
- Unificar formularios, modales, tablas, botones y estados.
- Crear estados vacios y estados de carga profesionales en todos los modulos.
- Preparar vistas moviles para app de chofer y enlaces de colaborador.

## Prioridad 5 - Calidad de producto

- Tests minimos de humo: login, crear pedido, editar pedido, colaborador, facturacion y permisos.
- Checklist de despliegue: build, health, migraciones, SMTP, Stripe, backups y CORS.
- Manual operativo dentro de la app para gerente, trafico, chofer y superadmin.
- Monitorizacion basica: logs con `request_id`, errores 500, emails fallidos y backups.

## Estado de esta pasada

- Anadida barrera global contra pantallas blancas.
- Mejorados errores de API para mensajes entendibles.
- Endurecido backend con `request_id`, CORS configurable, rate limit y headers.
- Anadidas migraciones de soporte para flujo profesional de colaboradores al arranque.
- Anadido migrador versionado en `transgest-backend/scripts/migrate.js`.
- Anadido smoke check reproducible en `transgest-backend/scripts/smoke_check.js`.
- Anadido sistema global de notificaciones en frontend.
- Anadido checklist de despliegue profesional.
- Anadida auditoria automatica de aislamiento multiempresa (`npm run audit:tenant`).
- Corregido aislamiento por `empresa_id` en rutas criticas de facturas, clientes, vehiculos, choferes, colaboradores, descargas, documentos de pedido y grupajes.
- Anadido manejo de errores asincronos en el sistema global de notificaciones.
- Optimizado `authenticate` para evitar doble consulta cuando una ruta ya llega autenticada.
- Anadida validacion de variables de entorno en arranque.
- Anadida auditoria automatica de acciones mutables en `audit_log_saas`.
- Sustituidos los `alert()` nativos por notificaciones globales dentro de la app.
- Anadida auditoria frontend de `alert()` pendientes (`npm run audit:alerts`).
- Anadidos avisos globales de exito/error para llamadas API mutables.
- Anadido dialogo global de confirmacion y migradas confirmaciones criticas de pedidos/facturacion.
- Anadida auditoria frontend de `window.confirm()` pendientes (`npm run audit:confirms`).
- Migrados todos los `alert()` nativos restantes a notificaciones globales (`npm run audit:alerts` queda a cero).
- Migrados todos los `window.confirm()` nativos restantes a dialogos internos (`npm run audit:confirms` queda a cero).
- El servicio de backups detecta `pg_dump` antes de ejecutarse, evita errores repetidos en logs y expone estado en TransGestAdmin.
- Sustituido el `JWT_SECRET` local por una clave aleatoria real y anadido `npm run check:env`.
- Migrados los `window.prompt()` nativos a dialogo interno y anadida auditoria `npm run audit:prompts`.
- Anadido backup JSON de contingencia cuando no existe `pg_dump`.
- Anadida migracion versionada `002_operational_hardening.sql` para auditoria, solicitudes de backup y eventos de pedido.
- Anadido check funcional autenticado (`npm run functional`) con login y endpoints criticos.
- Anadido manual operativo por rol en `docs/MANUAL_OPERATIVO.md`.
- Anadidos componentes UI compartidos (`FormField`, `FieldError`, `StatusBadge`, `ModalShell`, `EmptyState`, `LoadingState`).
- Migrada validacion del formulario de usuarios para mostrar errores junto a cada campo.

## Migracion UI pendiente

- Extender `FormField` y `FieldError` al resto de formularios grandes: pedidos, clientes, vehiculos y facturacion.
- Crear `DataTable` compartida para reducir estilos repetidos en listados.
