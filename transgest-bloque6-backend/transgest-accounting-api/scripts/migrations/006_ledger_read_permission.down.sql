DELETE FROM accounting.accounting_role_permissions rp
USING accounting.accounting_permissions p
WHERE rp.permission_id=p.id
  AND p.code='ledger.read';

DELETE FROM accounting.accounting_permissions
WHERE code='ledger.read';
