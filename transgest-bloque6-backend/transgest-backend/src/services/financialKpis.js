// Periodo economico y costes registrados, sin alterar las fechas operativas.
const financialPedidosCte = `pedidos_bi AS (
  SELECT p.*,
    CASE WHEN p.estado::text IN ('entregado','facturado')
      THEN COALESCE(p.facturacion_mes, NULLIF(to_jsonb(p)->>'entregado_at','')::date, p.firma_fecha::date, p.fecha_descarga, p.fecha_carga, p.fecha_pedido, p.created_at::date)
      ELSE COALESCE(p.fecha_descarga, p.fecha_carga, p.fecha_pedido, p.created_at::date)
    END AS fecha_bi,
    COALESCE(p.precio_colaborador,0) + COALESCE(p.coste_gasoil,0)
      + COALESCE(p.coste_peajes,0) + COALESCE(p.coste_dietas,0) + COALESCE(p.coste_otros,0) AS coste_operativo,
    NOT EXISTS (SELECT 1 FROM facturas f WHERE f.id=p.factura_id AND f.empresa_id=p.empresa_id
      AND f.estado::text NOT IN ('borrador','cancelada','anulada')) AS pendiente_factura
  FROM pedidos p WHERE p.empresa_id=$1
)`;

module.exports = { financialPedidosCte };
