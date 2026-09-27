CREATE TABLE IF NOT EXISTS operacion_evidencias (
 id UUID PRIMARY KEY,
 empresa_id UUID NOT NULL,
 pedido_id UUID NOT NULL,
 parada_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 payload JSONB NOT NULL,
 payload_hash TEXT NOT NULL,
 pdf BYTEA NOT NULL,
 pdf_hash TEXT NOT NULL,
 created_by UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(empresa_id,id),
 UNIQUE(empresa_id,pedido_id,parada_id,version),
 FOREIGN KEY(empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS signature_evidence (
 id UUID PRIMARY KEY,
 empresa_id UUID NOT NULL,
 operation_id UUID NOT NULL,
 client_operation_uuid UUID NOT NULL,
 request_hash TEXT NOT NULL,
 payload JSONB NOT NULL,
 package_hash TEXT NOT NULL,
 signature BYTEA NOT NULL,
 signature_hash TEXT NOT NULL,
 receipt_pdf BYTEA NOT NULL,
 receipt_hash TEXT NOT NULL,
 replaces_id UUID,
 created_by UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(empresa_id,id),
 UNIQUE(empresa_id,client_operation_uuid),
 FOREIGN KEY(empresa_id,operation_id) REFERENCES operacion_evidencias(empresa_id,id),
 FOREIGN KEY(empresa_id,replaces_id) REFERENCES signature_evidence(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS signature_evidence_annulments (
 empresa_id UUID NOT NULL,
 signature_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 created_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(empresa_id,signature_id),
 FOREIGN KEY(empresa_id,signature_id) REFERENCES signature_evidence(empresa_id,id)
);
DROP TRIGGER IF EXISTS operation_evidence_immutable ON operacion_evidencias;
CREATE TRIGGER operation_evidence_immutable BEFORE UPDATE OR DELETE ON operacion_evidencias FOR EACH ROW EXECUTE FUNCTION protect_transport_document_original();
DROP TRIGGER IF EXISTS signature_evidence_immutable ON signature_evidence;
CREATE TRIGGER signature_evidence_immutable BEFORE UPDATE OR DELETE ON signature_evidence FOR EACH ROW EXECUTE FUNCTION protect_transport_document_original();
DROP TRIGGER IF EXISTS signature_annulment_immutable ON signature_evidence_annulments;
CREATE TRIGGER signature_annulment_immutable BEFORE UPDATE OR DELETE ON signature_evidence_annulments FOR EACH ROW EXECUTE FUNCTION protect_transport_document_original();
