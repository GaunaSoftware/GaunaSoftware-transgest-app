# Almacén y control horario de oficina · 27/09/2026

## Alcance

- Gestión de almacén se agrupa en Operaciones. Se conserva el filtrado existente por plan, empresa y permisos; no se habilitan módulos nuevos al reagruparlos.
- Control horario tiene cabecera propia y no contiene navegación a Nóminas ni Hojas de ruta. Ambas áreas mantienen su navegación independiente.
- Tráfico, administración y contabilidad fichan entrada, descanso, reanudación y salida propios. Un visualizador con acceso de lectura explícito al módulo también dispone de estas acciones personales. No se exige permiso de edición de terceros para fichar.
- Los empleados pueden consultar sus registros y solicitar teletrabajo o vacaciones. Solo Gerencia ajusta fichajes (con motivo), configura horarios/base y resuelve solicitudes. Los roles externos y chófer no acceden a este registro de oficina; la app del chófer conserva su jornada específica.
- Las vacaciones de oficina tienen solicitudes propias, no fichas ficticias de chófer ni enlaces a nóminas. No se calculan saldos, devengos ni días laborables por suposición. Se muestran intervalos solicitados y decisión de Gerencia.

## Defectos corregidos

1. Administrativos y contables podían modificar fichajes; cualquier empleado podía guardar su jornada prevista.
2. El resumen filtraba el total personal, pero devolvía usuarios y jornadas abiertas de compañeros. Ahora todos los conjuntos respetan el mismo usuario y empresa.
3. Repetir salida cambiaba la hora registrada. Los reintentos devuelven el cierre original y no añaden otro evento.
4. La jornada abierta antes de medianoche desaparecía al consultar el nuevo día. Se recupera para cerrarla antes de abrir otra.
5. Los fichajes simultáneos no estaban serializados. Se usa bloqueo transaccional por empresa/empleado y de la fila abierta.
6. Configurar pausa de cero guardaba 60; ajustar pausa a cero podía insertar NULL. Ahora cero conserva su significado.
7. Faltaba `administrativo` en el enum de una instalación nueva, aunque el editor de usuarios y los permisos ofrecían ese rol. Reproducido en SQL real compatible y corregido mediante migración aditiva.
8. Consultas de jornada prevista usaban solo la empresa principal; ahora validan la membresía activa del contexto seleccionado. Gerencia no puede configurar un usuario de otra empresa.
9. Errores al cargar se disfrazaban de «sin fichar». Ahora se muestran y se bloquea el botón hasta recuperar el estado.
10. Las solicitudes futuras se ocultaban por el filtro de fichajes hasta hoy. Tienen un periodo propio ajustable.

Fechas de asistencia en Europe/Madrid, sin aceptar horas de fichaje enviadas por el empleado. Teletrabajo requiere aprobación para fichar en esa modalidad. Las solicitudes y ajustes conservan actor, fechas y evidencia en transacción; los ajustes conservan valores anteriores y posteriores.

## Pruebas

Sin modificaciones de fichajes reales. Datos sintéticos, correo y conexiones externas interceptados en el banco de auditoría.

- Backend: `node scripts/audit_workflows_regression_check.cjs`, código 0 con PGlite y con PostgreSQL 17.11 local. La suite HTTP usa `authenticate` y `requireModulePermission` reales: tres roles de oficina, plan Go, lectura sin edición, denegaciones explícitas, roles externos, dos empresas, usuario multiempresa con rol efectivo distinto, concurrencia, cierre repetido, jornada nocturna, pausas, solicitudes/aprobaciones y fechas inválidas. Incluye límites de cambio horario Europe/Madrid. La misma suite comprueba pedidos, tráfico, facturas/cobros, chófer, Planner, almacén e integraciones.
- Migrador real: 63 migraciones aplicadas; segunda ejecución sin alteraciones del registro.
- Copia/restauración local: 191 tablas / 764 filas; SHA-256 `2f7c5fcbabc8aca53b1f2f09a0dd0b7509313a09583d96edc374140bad6bce54`. No es una copia de producción.
- `npm run check` y `npm run security:regression`: código 0.
- Frontend: `CI=true npm test -- --watchAll=false --runInBand`: 63 suites / 147 pruebas correctas. Incluye empleados sin edición/enlaces financieros, jornada de Gerencia con empleado concreto, solicitudes futuras, error de API y Almacén sin duplicar permisos.
- `npm run build`: código 0, con dos trabajadores y sourcemaps desactivados para limitar memoria. Solo permanecen advertencias preexistentes de otros módulos. ESLint de los archivos UI modificados: código 0, sin avisos.
- Navegador local: login empleado → Operaciones/Almacén → Gestión/Control horario; horario de referencia solo lectura; solicitudes sintéticas de teletrabajo futuro y vacaciones; login gerente y aprobación visible. Escritorio y 390 px sin desbordamiento global (390/390); fechas manipuladas también con teclado. No se han probado iPhone/Android físicos.

El primer arranque del ensayo nativo usó un puerto incorrecto (55439); la repetición en el puerto real del servidor local (5432) terminó correctamente. No fue un fallo de la aplicación.

## Migración, compatibilidad y reversión

`scripts/migrations/20260927_office_vacations.sql` añade el valor de rol ya ofrecido y `oficina_vacaciones_solicitudes`, con claves de empresa/usuario, estado y fechas coherentes. Ejecutar `npm run migrate` antes del backend nuevo; es compatible con las tablas históricas y no reescribe fichajes, nóminas ni facturas.

Se conservan rutas y respuestas existentes de control horario. El cambio intencional de contrato es 403 al intentar gestionar registros desde un rol empleado. Las nuevas rutas `/control-horario/vacaciones` admiten listado propio/gerencia, alta propia y resolución exclusiva de Gerencia.

Antes de publicar: CI, copia verificable y migración. Después: comprobar SHA en `/health`, abrir el menú y Control horario con cuenta autorizada en modo lectura. Los fichajes y aprobaciones de validación se realizan solo en el banco sintético. El rollback normal debe conservar estas restricciones de permisos: volver al backend anterior reintroduciría las vulnerabilidades identificadas. No borrar tablas, solicitudes ni eventos como forma de revertir la interfaz.

Se mantiene el límite de una jornada por día del modelo previo. Una salida errónea requiere ajuste de Gerencia; no se habilita edición de empleados. La política de devengo/saldo de vacaciones y convenios queda fuera de este cambio.

## Reglas de publicación

No crear más entornos de prueba hospedados ni incrementar costes sin autorización. Conservar las pruebas locales y publicar en live tras superar los controles. No confundir las vistas previas de compilación con un despliegue verificado en producción.

No restaurar copias de verificación dentro del servidor que comparte el disco con producción. Antes de cualquier operación de copia, comprobar capacidad libre y tamaño previsto. Conservar las copias existentes y no eliminar información de clientes para liberar espacio. Cualquier retirada de una copia fallida debe identificar exclusivamente esa base y tener autorización explícita. Mantener las incidencias y los identificadores de infraestructura en el registro privado de operaciones.
