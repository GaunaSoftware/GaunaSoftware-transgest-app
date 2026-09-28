# Geotab como proveedor GPS

Geotab se configura por empresa, igual que los demás proveedores GPS. La conexión preparada usa la API de MyGeotab para leer dispositivos (`Device`) y su última posición (`DeviceStatusInfo`). No modifica vehículos de otras empresas ni inventa kilometraje: las posiciones se guardan en el historial GPS existente.

## Activación para TLM

1. Crear en MyGeotab un usuario API de TLM con acceso de lectura a dispositivos y posiciones. Obtener el nombre exacto de la base de datos de MyGeotab.
2. En SuperAdmin → Integraciones → GPS de empresa, seleccionar TLM y **Geotab GPS**. En «Credenciales Geotab de esta empresa» introducir un JSON con este formato, sustituyendo los valores de ejemplo: `{"database":"base-tlm","userName":"usuario-api@ejemplo.invalid","password":"CLAVE"}`. El programa cifra el secreto; no guardarlo en el repositorio ni enviarlo por chat.
3. Usar «Probar conexión». La prueba autentica y comprueba lectura de `Device` y `DeviceStatusInfo`. Después, sincronizar desde Vehículos → GPS. Se enlaza por ID Geotab previamente registrado o, si el tipo de dispositivo publica matrícula, por matrícula **única** en ambas flotas. Las coincidencias ambiguas quedan sin enlazar y se informan en el resultado. Si un dispositivo no publica matrícula, registrar su ID Geotab en la ficha del vehículo.
4. Para actualización periódica, configurar `GPS_POLL_INTERVAL_MIN` en el servidor. El programador existente está desactivado por defecto y, si se activa, consulta las empresas con Movildata o Geotab activos. Solo puede haber un proveedor GPS activo por empresa.

No se han recibido credenciales de Geotab de TLM, por lo que no se ha hecho una conexión real ni se ha asignado ningún dispositivo a TLM. El límite por consulta es 5.000 dispositivos o posiciones; por encima se detiene con un error explícito hasta implantar paginación. La posición de MyGeotab es la última comunicada por el dispositivo, no garantiza seguimiento continuo. Esta primera integración no importa odómetro ni trayectos históricos.

Referencias oficiales: [autenticación](https://developers.geotab.com/myGeotab/apiReference/methods/Authenticate/), [conceptos de la API](https://developers.geotab.com/myGeotab/guides/concepts/index.html), [Device](https://developers.geotab.com/myGeotab/apiReference/objects/Device/), [GoDevice y matrícula](https://developers.geotab.com/myGeotab/apiReference/objects/GoDevice/) y [DeviceStatusInfo](https://developers.geotab.com/myGeotab/apiReference/objects/DeviceStatusInfo/).

## Comprobaciones locales

`node scripts/geotab_gps_check.cjs` verifica autenticación simulada, rechazo de host ajeno a Geotab, mapeo por matrícula y descarte de duplicados. La validación real requiere las credenciales y permisos de TLM.
