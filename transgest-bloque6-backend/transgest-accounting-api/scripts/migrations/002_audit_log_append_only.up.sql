CREATE OR REPLACE FUNCTION accounting.prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accounting.audit_log is append-only; % is not allowed', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON accounting.audit_log;

CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON accounting.audit_log
FOR EACH STATEMENT
EXECUTE FUNCTION accounting.prevent_audit_log_mutation();
