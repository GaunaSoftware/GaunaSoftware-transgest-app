# Paralización rápida y prefactura

27/09/2026. Desde el pedido: **Paralización / prefactura → Ha habido una paralización · prefacturar**. Seleccionar carga/descarga, motivo, puesta a disposición pactada y final real. Confirmar causa no imputable al porteador. Calcular y crear el PDF sin IVA.

## Definición

- Fuente: [Ley 15/2009, artículo 22](https://www.boe.es/buscar/act.php?id=BOE-A-2009-18004#a22) y [SEPE/IPREM](https://www.sepe.es/HomeSepe/prestaciones-desempleo/Cuantias-anuales.html), consultados 27/09/2026.
- IPREM diario 20 €; primera hora excluida; 40 €/hora o fracción, máximo diez horas diarias; segundo día 50 €/hora, siguientes 60 €/hora. Puede declararse un pacto superior con su descripción. No se sustituye por una tarifa inferior.
- Criterio temporal visible: periodos consecutivos de 24 horas desde la puesta a disposición, franquicia una sola vez. Se utilizan instantes con zona para medir la duración real, incluso con cambio horario. Transporte nacional España. Fechas fuera de 2023–2026 no se calculan automáticamente hasta revisar su IPREM; conservan la revisión manual documentada.
- La propuesta almacena referencia, tarifa, desglose, partes y pedido en una instantánea. El PDF posterior conserva esa propuesta aunque cambien los datos maestros.
- **Prefactura sin validez fiscal**, sin IVA liquidado; no atribuye una exención a todas las paralizaciones. Una indemnización real y una contraprestación adicional pueden tener distinto tratamiento conforme al [artículo 78 de la Ley del IVA](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740#a78). La emisión definitiva utiliza el flujo fiscal existente con revisión del régimen aplicable.
- Estado `preparada`: pendiente de evidencia y aceptación. Documentado y aceptado permanecen en cero; no altera facturas, cobros ni precio base. Desde Revisar se adjunta evidencia del pedido y se registra la aceptación; entonces se aplica el cargo separado que ya concilia con BI/facturación.

## Seguridad y migración

`20260929_detention_prefacturas.sql` amplía estados y añade la instantánea; permite documento nulo solamente en una propuesta sin ingreso aceptado. Conserva las reclamaciones previas. Reutiliza expediente, eventos auditados, bloqueo por pedido, idempotencia y aislamiento de empresa. Descarga autenticada privada, sin enlace público. No envía correos automáticamente.

El cálculo se ejecuta y repite en servidor al guardar. Los intervalos superpuestos se rechazan. Una respuesta perdida con el mismo identificador devuelve el mismo expediente. La propuesta no se contabiliza como importe documentado facturable en BI.

Pruebas: límites de franquicia/fracción/días, pacto superior, fechas inválidas/futuras, DST, aislamiento, concurrencia, PDF real y transición a reclamación sin duplicar importe. Los resultados finales se anotan en el acta de despliegue de esta entrega.
