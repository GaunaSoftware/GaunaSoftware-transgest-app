# App del chófer: gastos, conjunto, documentos y tabla de pedidos

## Cambios

- Pedidos conserva la tabla de escritorio al plegar/desplegar el panel de seguimiento. Con panel abierto permite desplazamiento horizontal; plegado aprovecha el ancho. El móvil conserva sus tarjetas.
- Jornada sin casillas de confirmación. Conjunto permite cambiar tractora/remolque durante el día, registrando ubicación, cuentakilómetros y los kilómetros del vehículo anterior. El registro conserva los tramos y no mezcla los odómetros de dos camiones.
- Inicio y Más incluyen Conjunto y, para chóferes propios, Repostajes y dietas.
- Repostajes externos: fecha, población, provincia, litros e importe. Repostajes en base: pendientes de valoración; la empresa completa litros/importe en Hojas de ruta. Los tickets se guardan con el camión, chófer y jornada; los reintentos tienen una clave idempotente.
- Hojas de ruta incluye los gastos registrados de la app, además de los registros previos. Corrige también el cálculo cuando coexistían repostajes con importe y otros solo con litros.
- Mi empresa permite crear bases y ubicaciones habituales para la app.
- El DCD queda oculto hasta marcar carga finalizada y la API del chófer rechaza su consulta anterior. El flujo existente permite confirmar la mercancía real antes de finalizar. Tráfico conserva su acceso documental.
- Escáner de cámara con detección de papel, marco visible, ajuste táctil de las esquinas, revisión y recorte antes de adjuntar. Funciona también seleccionando una foto cuando no está disponible la cámara en directo. El recorte es rectangular: no se anuncia corrección de perspectiva ni extracción automática de importes.
- El indicador Pendiente del DCD se adapta al ancho del móvil.

## Datos y permisos

Esquema aditivo e idempotente: empresa_ubicaciones_operativas, chofer_gastos y dos columnas en chofer_jornadas (km_tramo_inicio, km_acumulados). No borra ni reescribe pedidos. Arranque espera a que el esquema esté disponible. Los justificantes se sirven con autenticación, comprobación de empresa/chófer y validación de MIME/contenido, máximo 3 MB. La valoración usa el permiso editar de hojas_ruta; ubicaciones usa empresa. Transportistas externos no acceden a los gastos de flota propia.

## Validación

- Suite backend general y PostgreSQL aislado: gastos, importes, tickets, aislamiento, idempotencia, valoración de base, cambio de conjunto, suma de tramos y rechazo sin modificaciones de odómetros incorrectos.
- Prueba de DCD: rechazo antes de carga, acceso después, rechazo a otro conductor y acceso de gerencia.
- 25 suites / 60 pruebas unitarias frontend y compilación de producción. Advertencias anteriores de lint no relacionadas con estos cambios.
- Navegador con APIs sintéticas: tabla a 1920/1662/1440/1280/768/390 px; panel abierto/plegado; costes en Hojas de ruta y valoración sin duplicados.
- scripts/driver_browser_check.cjs verifica jornadas sin casillas, conjunto, DCD, ticket y recorte con una imagen sintética; revisar su resultado antes de desplegar.

## Comprobación del cliente

1. Pedidos: abrir/cerrar panel lateral y comprobar que no cambia el formato de filas.
2. Chófer: Inicio → Cambiar conjunto; registrar matrícula, remolque, ubicación y kilómetros. Abrir/cerrar jornada sin confirmar casillas.
3. Inicio → Repostajes y dietas: registrar un ticket externo y otro en base. Revisar ambos en Hojas de ruta; valorar el de base y comprobar el total.
4. Mi empresa → Bases y ubicaciones para los chóferes: crear una base y seleccionarla en la app.
5. Viaje antes de carga: no ofrece DCD. Completar el flujo de carga y confirmar mercancía; entonces aparece el documento.
6. Cámara del teléfono: permitir acceso, encuadrar el papel, capturar, ajustar y aceptar el recorte. La prueba de navegador no sustituye a probar físicamente Android/iPhone y su permiso de cámara.
