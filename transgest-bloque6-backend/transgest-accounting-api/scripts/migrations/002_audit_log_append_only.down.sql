DROP TRIGGER IF EXISTS trg_audit_log_append_only ON accounting.audit_log;
DROP FUNCTION IF EXISTS accounting.prevent_audit_log_mutation();
