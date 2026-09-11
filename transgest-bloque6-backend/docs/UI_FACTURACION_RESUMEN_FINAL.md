# Facturación · composición final del resumen

Se aplica la captura final facilitada por el usuario al contenido de Finanzas. Se mantienen los logos y la organización lateral ya acordada.

## Pantalla

- Resumen es la entrada inicial de Finanzas. Resumen, Facturas, Cobros, Pagos, Tesorería y Fiscal usan la misma definición y selección en el lateral y en las pestañas superiores. Un acceso con foco desde Control Tower sigue abriendo Facturas.
- Cabecera con período y Nueva factura; cuatro indicadores y un bloque compacto de incidencias.
- Gráfica de previsión a la izquierda y viajes pendientes a la derecha. La curva usa los buckets existentes (actual, vencido, 0–7, 8–30 y 31–60 días), sin inventar puntos a 15 días ni tendencias mensuales. No se repite la tarjeta del saldo previsto a 30 días.
- Tabla de clientes con Base, IVA, estados, fiscalidad y las acciones anteriores. Resumen presenta 5 o 10 facturas por página sobre la colección cargada; muestra explícitamente ese alcance y el total del período. Ver todas abre el listado completo y su paginación existente del servidor, sin alterar la carga de 50 registros ni los cálculos basados en ella.
- La búsqueda y los filtros de estado, período y fiscalidad conservan su estado y llamadas existentes. El selector de cliente del resumen filtra la colección cargada; no representa una búsqueda adicional sobre todo el servidor.
- Exportar abre el componente contable existente en un drawer y respeta los permisos previos de edición y configuración.
- Tres bloques inferiores: documentación, control de cobros y fiscalidad. Abren los flujos existentes y muestran únicamente los datos disponibles.

## Responsive y compatibilidad

La composición se compacta en escritorio. En tablet los indicadores e incidencias se reorganizan y las columnas secundarias se ocultan. En móvil los bloques se apilan, la tabla se convierte en tarjetas y Nueva factura queda accesible abajo; se conservan controles táctiles de 44 px y los filtros en drawer.

El gráfico tiene descripción accesible con los importes por plazo. La paleta de empresa y los temas claro/oscuro se mantienen. No se cambian APIs, payloads, modelos, permisos, estados de negocio ni cálculos financieros. Los datos de las capturas de validación proceden exclusivamente de fixtures locales.

## Verificación

`finance_browser_check.cjs` cubre entrada por Resumen, composición, paginación local, cliente, búsqueda, exportación, documentos, viajes, seis pestañas sincronizadas, ambos temas y tamaños de móvil a escritorio. Se conservan las comprobaciones de 37 cálculos/handlers financieros y 34 casos de jerarquía y permisos.

La validación en navegador no sustituye una prueba de distribución de los binarios Electron o aplicaciones nativas.

Resultado final: build y check correctos; 154 comprobaciones de navegador, 37 de preservación financiera y 34 de navegación/permisos superadas. Sin errores de consola ni nuevos avisos de compilación; permanecen los dos avisos previos de hooks en GestionTrafico y MiCuenta. Se revisaron las capturas de referencia a 1536×1024 y de móvil en ambos temas. La prueba combina selección de cliente y búsqueda sin resultados para verificar que el filtro no pierde su selección visible.
