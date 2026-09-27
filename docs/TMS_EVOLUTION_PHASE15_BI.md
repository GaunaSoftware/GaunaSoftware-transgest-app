# Fase 15 · BI conciliado con el modelo físico

## Implementación

Se conservan Dirección, Rentabilidad, Operaciones, Flota, Calidad y Centro de informes (React/Recharts). Planner/WMS tiene acceso separado y autorización del servidor; muestra citas y duración efectiva del modelo existente, no valoraciones ficticias de inventario. Vistas guardadas, PDF/Excel/CSV, informes semanales y permisos reutilizan el centro ya implementado.

`financialJourneys` concilia antes de filtros/paginación: viajes activos de la empresa, todos sus pedidos para determinar denominadores, costes no anulados hasta el corte. Peso completo; si falta, bultos completos; si faltan ambos en un grupaje, reparto no calculable. Los céntimos se distribuyen de forma determinista conservando el total. Un coste registrado explícitamente a cero se distingue de ningún coste.

Los kilómetros materiales se atribuyen proporcionalmente a pedidos y se agregan una sola vez por viaje. El detalle conserva los IDs físicos. Se usa la asignación snapshot del viaje; varios recursos no se atribuyen arbitrariamente a uno. No se reconstruye historia anterior a la materialización. Los legacy mantienen su criterio anterior de grupaje con advertencia de discrepancias.

Los costes físicos no se añaden cuando ya existen costes en pedidos y falta enlace documental para descartar solape. Aparecen como pendientes de conciliación y operación a revisar. No se suman otra vez las facturas de proveedor revisadas. Taller, nómina y estructura no producen un supuesto resultado completo si pueden solaparse con conceptos genéricos de viaje.

El resumen compatible del dashboard y hojas de ruta reutilizan esta conciliación. Las facturas identificadas por preparación Planner se excluyen del perímetro transportista. No se alteran importes ni documentos históricos.

Cada métrica económica añade fuente, periodo, updated_at, comparación, tendencia y objetivo cuando comparable/configurado; null significa no disponible. Acceso al detalle desde las tarjetas. Las métricas operativas no inventan una comparación histórica cuando la serie no se ha calculado.

## Evidencia

- `financial_journeys_check.cjs`: referencia 1500/1250/800/200 => 1,50/1,25/0,25 €/km, 250 € y 20 %; pesos/bultos, céntimos, 1501 pedidos, página independiente, recursos históricos, empresa ajena, anulación, duplicados y ausencia de datos.
- `audit_physical_bi.cjs`, dentro del banco HTTP real: tarjetas, serie, matriz y página de detalle reconcilian los mismos 250 €, 1000 km y 2 servicios; cambiar de página conserva totales.
- `npm run bi:regression`: código 0; conserva pruebas de impuestos, cortes, permisos, informes PDF/XLSX/CSV y scheduler sintético. Se corrigió el doble de base del test antiguo para respetar los parámetros reales de cada consulta y fechas explícitas.
- `npm test -- --watchAll=false --runInBand`: 56 suites, 130 pruebas, código 0. Build de frontend local: código 0, avisos de lint anteriores.

## Límites

No existe todavía enlace universal entre ticket importado, gasto de pedido y coste físico: los posibles solapes requieren conciliación. Los pedidos con varios vehículos históricos necesitan atribución económica por tramo para presentar una cuenta de cada vehículo; se señalan, no se inventa. Los grupos legacy pueden conservar distancias ambiguas. El margen sigue siendo directo registrado, no beneficio neto. Stock histórico, consumo real entre aforos y ocupación homogénea continúan condicionados por las fuentes documentadas en el catálogo BI. Sin nuevas migraciones, servicios de pago, envíos externos ni producción.

Comprobación visual local: Dirección a 1440 px, filtro del cliente sintético y móvil 390 px sin desbordamiento global (scrollWidth = clientWidth = 390); leyendas y navegación conservadas. Navegación Finanzas > Informes > Informes de gestión verificada. No se repitieron en esta fase las resoluciones 768/1920 ni pruebas físicas iOS/Android.
