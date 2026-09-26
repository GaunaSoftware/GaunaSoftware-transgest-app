-- Explicit shipment declarations, independent of route order. No historical inference.
CREATE TABLE IF NOT EXISTS pedido_envios_operaciones (
 empresa_id UUID NOT NULL,
 client_operation_uuid UUID NOT NULL,
 pedido_id UUID NOT NULL,
 request_hash TEXT NOT NULL,
 resultado JSONB NOT NULL,
 created_by UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(empresa_id,client_operation_uuid),
 FOREIGN KEY(empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id)
);
DROP TRIGGER IF EXISTS shipment_declaration_immutable ON pedido_envios_operaciones;
CREATE TRIGGER shipment_declaration_immutable BEFORE UPDATE OR DELETE ON pedido_envios_operaciones
FOR EACH ROW EXECUTE FUNCTION protect_transport_document_original();
