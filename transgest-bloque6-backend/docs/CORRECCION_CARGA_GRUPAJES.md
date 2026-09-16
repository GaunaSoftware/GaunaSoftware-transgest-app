# Carga de pedidos y grupajes

La ficha utiliza una cantidad de palets/bultos y una longitud ocupada (ML). Los nombres antiguos se mantienen sincronizados en el envío a la API para conservar la compatibilidad de documentos e informes.

El tipo de palet muestra sus dimensiones. La cantidad calcula longitud y ancho sobre un ancho útil de referencia de 2,40 m, probando ambas orientaciones. La opción de apilado mantiene el supuesto existente de dos alturas. Las dimensiones se pueden modificar manualmente y se conservan al cambiar la cantidad.

Grupajes utiliza el mismo cálculo y no suma campos duplicados. Se da prioridad a la longitud de carga declarada; el antiguo valor predeterminado de 13,65 ML no oculta el cálculo por palets cuando no hay longitud declarada. La API conserva las dimensiones al crear el pedido y las devuelve en el listado de tráfico.

Validación: pruebas de cálculo y compatibilidad, formulario en navegador con API simulada, compilación del frontend y revisión sintáctica del backend. Requiere desplegar frontend y backend; utiliza columnas de carga ya existentes.
