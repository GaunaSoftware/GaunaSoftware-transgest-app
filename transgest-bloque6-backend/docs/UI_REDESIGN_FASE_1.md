# Finanzas · UI redesign v1

Rama: `ui-redesign-v1`. Alcance: Fase 1. Las pantallas de Fase 2 no se migran en este bloque.

Actualización del 11/09/2026: el refinamiento basado en las referencias de Facturación se documenta en [UI_REDESIGN_REFERENCIAS_FINANZAS.md](UI_REDESIGN_REFERENCIAS_FINANZAS.md). Esa entrega actualiza la densidad, el breakpoint móvil a 768 px, los indicadores contextuales y los accesos inferiores de soporte/salida. Los detalles siguientes describen la primera entrega.

## Arquitectura

- `src/ui/index.js` expone Button, Card, Badge, Tabs, Page, PageHeader, Section, KpiCard, FilterBar, DataTable, MobileDataCard, Drawer, Modal, EmptyState, SearchInput y Select, además de DropdownMenu.
- `src/ui/transgest-ui.css` define espaciado, radios, densidad, tipografía y responsive. Los colores se resuelven con los tokens de `companyPalette.js`; no se añade otro proveedor de tema ni dependencias.
- `src/components/ui.js` conserva su API y comportamiento. Las futuras migraciones pueden sustituir sus primitivas por las nuevas de forma explícita.
- `src/pages/finance/InvoiceList.js` recibe datos y handlers. Presenta ocho columnas, filas de 64 px y cards por debajo de 640 px. La tabla y las cards comparten las condiciones de acciones y el estado de agrupación por cliente.
- `src/pages/finance/TreasuryView.js` representa los buckets ya calculados mediante Recharts, una tabla y movimientos próximos. El gráfico acumula los mismos cobros y pagos; no cambia el cálculo de previsión.
- `src/pages/finance/finance.css` controla los grids y formularios del módulo con clases explícitas, sin selectores por atributos `style`.

## Experiencia

La cabecera ofrece Nueva factura y las pestañas Facturas, Cobros, Pagos, Tesorería y Fiscal. Se mantienen cuatro indicadores principales y una franja de señales. Rectificadas y cobrado permanecen en el listado de facturas.

Facturas muestra Ver y un menú secundario. Se mantienen Emitir, Enviar/Reenviar, Marcar cobrada, Reclamar, Sin cobrar, Rectificar, reencolar Fiscal y Eliminar borrador, bajo las mismas condiciones anteriores. El selector de todos los estados del borrador sigue disponible mediante Cambiar estado. Nueva factura abre el asistente existente de facturación de pedidos.

Los filtros de estado y período permanecen visibles en escritorio. Más filtros reúne los filtros fiscales y sus contadores. En móvil, Filtros abre un drawer con los mismos valores controlados.

Los viajes sin facturar se resumen y se consultan en un drawer. Pagos presenta proveedores y abre sus viajes y acciones en un drawer. Cobros resume los bloqueos documentales, conserva el seguimiento prioritario en un desplegable y permite consultar el listado paginado con sus filtros. El bloque AEAT queda en Fiscal; la franja muestra incidencias o falta de disponibilidad del resumen.

Los siete overlays de Finanzas usan Modal. Drawer y Modal comparten Escape, cierre por fondo, trampa de foco, retorno de foco, scroll y soporte para diálogos anidados. Los formularios grandes ocupan toda la pantalla en móvil. Las líneas de factura y los pedidos del asistente se presentan como registros verticales etiquetados en móvil, conservando selección y edición.

## Layout y compatibilidad

Las reglas heredadas del Layout que buscaban `style`, forzaban inputs o convertían tablas en bloques quedan limitadas a `.tg-content--legacy`. Finanzas excluye esa clase. Las pantallas aún no migradas conservan esas reglas para evitar regresiones fuera del alcance.

Se mantiene el sidebar expandido, colapsado y el menú móvil, así como las pestañas superiores. Se conserva su breakpoint previo de 1024 px. El Design System usa móvil <640 px, tablet 640–1023 px y desktop desde 1024 px; los drawers de tablet ocupan 75vw y los móviles 100vw.

El código usa React 18, CSS, react-dom y Recharts ya instalados. No se cambian CRA, Electron, Capacitor, los proyectos nativos ni los archivos de dependencias. La validación en navegador no sustituye las pruebas de distribución en dispositivos Android/iOS ni de binarios Electron.

## Comportamiento y límites conservados

- No se cambian servicios, endpoints, modelos, permisos, planes, reglas fiscales ni cálculos financieros.
- Facturado, cobrado y por cobrar se calculan sobre las facturas actualmente cargadas, con el período y filtros existentes; no constituyen un agregado completo del servidor. La cabecera lo indica. La previsión sigue usando las facturas y pagos cargados.
- Los viajes sin facturar conservan el límite de 1.000 registros de la llamada original. El drawer explicita ese límite.
- Los bloqueos conservan los 12 elementos de la vista anterior; el total del resumen puede ser mayor. Los listados fiscales y de seguimiento conservan sus límites previos.
- La función de carga anterior elimina automáticamente los borradores huérfanos sin pedidos. Este comportamiento preexistente se conserva y requiere una revisión funcional separada si se quiere cambiar. Las pruebas de esta fase no utilizan facturas reales.
- Se conservan la paginación y los filtros compartidos. Se añaden anclas para el foco desde Control Tower en ambas presentaciones.
- Los cambios de presentación incluyen pestañas, expansión de detalles, menús, filtros en drawer, Escape y gestión del foco. No se añaden transiciones de negocio.
- La exportación contable sigue disponible en un desplegable, con los mismos permisos y handlers.

## Validación reproducible

Resultado final local: `npm run check` y `npm run build` completados; 97 comprobaciones de navegador superadas sin errores de consola y 37 comprobaciones de lógica preservada. Las tres escrituras registradas por el test son simulaciones locales (dos de inicialización del tutorial y un cambio de estado de factura). La fecha de la prueba queda fijada en septiembre de 2026 para reproducir los períodos de los datos de ejemplo.

Desde `transgest-frontend`:

```powershell
npm run check
npm run build
node scripts/finance_preservation_check.cjs
# Usar Playwright instalado o definir PLAYWRIGHT_MODULE hacia el runtime disponible.
node scripts/finance_browser_check.cjs
```

El control de preservación compara 37 cálculos, funciones de carga y handlers asíncronos, más las importaciones de API, con la revisión previa `24abb6f`. Acepta otra revisión como argumento si se necesita usar en una migración posterior.

La prueba de navegador sirve el build local y simula todas las respuestas y escrituras de API. Comprueba las cinco pestañas a 390, 430, 768, 1024, 1366, 1440 y 1920 px en claro y oscuro; filas desktop de hasta 72 px; cards móviles; drawers; selección y edición de líneas del asistente; filtros; menús por estado; un cambio de estado simulado; permisos de lectura; sidebar colapsado y móvil; paleta personalizada; ausencia de datos y de resumen fiscal; errores de consola. Genera capturas y `build/qa/finance/report.json`.

Las compilaciones muestran dos advertencias previas de dependencias de hooks: `GestionTrafico.js:2085` y `MiCuenta.js:163`, además del aviso de deprecación de `fs.F_OK` de la herramienta de build. Se dejan fuera de esta migración visual.

## Continuidad

La Fase 2 debe migrar cada feature de forma independiente y retirar su dependencia de `.tg-content--legacy` cuando disponga de responsive propio. Antes de extender el patrón, conviene revisar Finanzas con datos representativos de producción y en los contenedores nativos. Se conservaron los cambios locales previos del repositorio fuera de los commits de esta fase.
