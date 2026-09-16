// Shared by external invoice readers; fd is a factura_docs snapshot.
const CUSTOMER_INVOICE_DOCUMENT_SCOPE = `EXISTS (
  SELECT 1 FROM facturas owner
  WHERE owner.id=fd.factura_id AND owner.empresa_id=fd.empresa_id
    AND (
      (fd.pedido_id IS NULL AND fd.pedido_doc_id IS NULL)
      OR EXISTS (
        SELECT 1 FROM factura_pedidos link
        JOIN pedidos source ON source.id=link.pedido_id
          AND source.empresa_id=owner.empresa_id AND source.cliente_id=owner.cliente_id
        WHERE link.factura_id=owner.id AND source.id=fd.pedido_id
          AND (fd.pedido_doc_id IS NULL OR EXISTS (
            SELECT 1 FROM pedido_docs original
            WHERE original.id=fd.pedido_doc_id AND original.pedido_id=source.id
              AND original.empresa_id=owner.empresa_id
          ))
      )
    )
)`;

module.exports = { CUSTOMER_INVOICE_DOCUMENT_SCOPE };
