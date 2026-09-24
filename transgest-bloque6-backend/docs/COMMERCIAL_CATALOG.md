# Catálogo comercial TransGest (24/09/2026)

Los importes se muestran sin IVA. Usuarios y vehículos son ilimitados en los tres planes TMS. La contratación anual aplica un 15 % de descuento sobre doce mensualidades.

| Origen | Plan | Mensual | Anual con descuento | Integración estándar |
| --- | --- | ---: | ---: | ---: |
| Directa | Go | 169 € | 1.723,80 € | 1.500 € + IVA |
| Directa | Pro | 349 € | 3.559,80 € | 1.500 € + IVA |
| Directa | Pro Intelligence | 479 € | 4.885,80 € | Incluida |
| Canal | Go | 259 € | 2.641,80 € | 1.500 € + IVA |
| Canal | Pro | 539 € | 5.497,80 € | 1.500 € + IVA |
| Canal | Pro Intelligence | 959 € | 9.781,80 € | Incluida |

Go contiene operativa esencial, documentación, facturación e importación. Pro añade control integral, KPIs e informes. Pro Intelligence añade IA y 1.000 consultas al mes. Bloques adicionales de 500 consultas: 49 €/mes. Ampliación documental: 39 € por 100 GB/mes. Los nuevos conectores y desarrollos tienen presupuesto específico.

## Aplicación y despliegue pendiente

- El catálogo ejecutable está en `transgest-backend/src/services/commercialPricing.js`. SuperAdmin registra el origen comercial por empresa. El checkout comprueba el importe, EUR y periodicidad real del Price de Stripe antes de crear una sesión.
- La migración `20260924_commercial_origin.sql` cambia el identificador del plan Control a Pro. No modifica facturas emitidas ni suscripciones existentes de Stripe.
- Las empresas existentes quedan **sin origen clasificado**. SuperAdmin debe asignar Directa o Canal después de revisar su contrato; hasta entonces no se genera una nueva sesión de pago TMS. Esto evita aplicar automáticamente un precio incorrecto. La estimación MRR excluye las empresas no clasificadas y muestra su número.
- Configurar seis IDs de Stripe para cada origen y periodo: `STRIPE_PRICE_LITE_MENSUAL_DIRECTA`, `STRIPE_PRICE_LITE_ANUAL_DIRECTA`, `STRIPE_PRICE_PROFESIONAL_MENSUAL_DIRECTA`, `STRIPE_PRICE_PROFESIONAL_ANUAL_DIRECTA`, `STRIPE_PRICE_ENTERPRISE_MENSUAL_DIRECTA`, `STRIPE_PRICE_ENTERPRISE_ANUAL_DIRECTA`, y sus equivalentes `_CANAL`. Verificar precios antes de activar contrataciones. Los IDs de Planner siguen separados.
- Las tarifas de Planner y Pro Planner no se han supuesto ni modificado.
- Antes de desplegar, ejecutar las migraciones, las pruebas comerciales y de permisos, la compilación completa, y revisar los contratos existentes. Ninguno de estos pasos debe reescribir condiciones contractuales anteriores sin decisión comercial expresa.
