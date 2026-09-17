# Editor de pedidos · 17/09/2026

## Alcance

Crear y editar pedidos, conservando el controlador y contratos API existentes. No se modifica la barra lateral, la navegación global, Planner, facturación ni el backend.

La presentación se extrae de `Pedidos.js` en `src/pages/orders/editor/`. Se reutilizan Modal, Card, Button, Tabs, Badge y DropdownMenu del sistema visual existente. La lógica de tarifas, ADR, asignación, riesgos, documentos y guardado permanece en los componentes/servicios originales.

## Cambios

- Dos pasos: **Transporte y mercancía** y **Ejecución y costes**. Cambiar de paso no guarda; los campos, archivos y secciones permanecen montados.
- Mapa compacto con recalculado secundario; cliente, tarifa, planificación, paradas y mercancía agrupados. Se conserva el formulario completo de puntos de interés.
- Opciones de precio, dimensiones, kilómetros en vacío, costes y documentos bajo secciones desplegables. ADR conserva el componente y reglas originales.
- Flota propia o colaborador, con el conjunto automático existente. Enviar/reenviar solo con pedido y asignación guardados; estado de seguimiento después del envío.
- Acceso temporal: generar, copiar, abrir y revocar, utilizando los servicios de tokens existentes. La revocación se confirma antes de ejecutarse.
- Notas, resumen económico, rentabilidad y última actividad más compactos. Historial expandible.
- AvIm se recoge en la cabecera mientras está abierto el editor. Al cerrar vuelve a su ubicación y configuración habitual.
- Menús de paradas y botones de cálculo se reconocen como interacción para advertir sobre cambios pendientes antes de salir.
- Diseño claro/oscuro; móvil a pantalla completa y pie con acciones visible.

## Verificaciones

- `npm run check`: correcto, incluida auditoría de contraste.
- `npm test -- --watchAll=false --runInBand`: 25 suites, 58 pruebas correctas.
- `npm run build`: correcto. Mantiene advertencias ESLint preexistentes, sin errores de compilación.
- Navegador Edge sobre build de producción y API simulada, con datos ficticios. Sin errores JavaScript de ejecución.
- Anchos 375, 390, 393, 430, 768 y 1920: ambos pasos sin desbordamiento horizontal; pie visible. Capturas revisadas en claro y oscuro.
- En 1920×1080, caso habitual: contenido de 1578 px en el paso 1 y 1335 px en el paso 2. Las secciones avanzadas, ADR y múltiples paradas amplían la altura cuando se necesitan.

| Escenarios solicitados | Cobertura |
| --- | --- |
| Flota propia/colaborador, con/sin ADR | Cuatro combinaciones, visibilidad correcta de formularios |
| Colaborador no enviado/enviado | Enviar frente a reenviar, seguimiento condicional |
| Acceso temporal | Generación y revocación contra API simulada; copiar/abrir disponibles al generarlo |
| Ruta guardada/manual | Selector de tarifa, ruta manual del pedido y retención del borrador |
| Punto existente/nuevo | Selección del punto guardado; formulario completo y guardado simulado |
| Una/varias cargas y descargas | Tarjetas, edición, reordenación y aviso de cambios al salir |
| Sin/con costes | Resumen, expansión, modificación conservada al cambiar de paso |
| Sin/con documentos | Estado vacío, documentos guardados, adjunto previo al alta y carga al guardar |
| Sin/con rentabilidad | Mensaje de datos insuficientes y recomendación cuando hay datos |
| Pedido nuevo/editado | Alta y edición simuladas; payload conserva datos; 4,2 toneladas → 4200 kg |
| Trazabilidad y AvIm | Última actividad/historial completo; avisos recogidos sin tapar acciones |
| Asignación automática | Seleccionar tractora rellena conductor y remolque existentes |

## Repetir la prueba de navegador

Desde `transgest-bloque6-backend/transgest-frontend`, con Node y Playwright instalados:

```text
npm run build
node scripts/order-editor-regression.cjs
```

La prueba usa Chromium de Playwright por defecto. `BROWSER_CHANNEL=msedge` permite utilizar Edge instalado. `PLAYWRIGHT_MODULE_PATH` permite señalar una instalación externa de Playwright. Requiere el puerto local 4395 libre. `ORDER_EDITOR_QA_OUTPUT` cambia la carpeta de evidencias; por defecto se guardan en `tmp/order-editor-qa` del repositorio.

## Límites de la validación

Las pruebas de escritura, envío, puntos, adjuntos y tokens utilizan una API local simulada. No se han enviado correos ni modificado pedidos de clientes reales. El mapa se monta con MapLibre y respuestas de routing simuladas; esta prueba no certifica la disponibilidad del proveedor cartográfico. No hay migraciones ni cambios en contratos del backend.

## Comprobación recomendada tras publicar

1. Abrir un pedido, cambiar una referencia y volver entre los pasos; guardar y volver a abrirlo.
2. Crear un pedido de prueba con un PDF; comprobar el documento tras guardar.
3. Revisar un pedido propio y uno de colaborador, y la asignación automática del conjunto.
4. Cambiar el orden de una parada y comprobar el aviso antes de salir sin guardar.
5. Revisar el mapa real y el editor desde un móvil, en claro y oscuro.
