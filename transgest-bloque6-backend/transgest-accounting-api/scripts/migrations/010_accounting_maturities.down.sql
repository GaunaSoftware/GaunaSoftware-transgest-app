DELETE FROM accounting.accounting_role_permissions rp
USING accounting.accounting_permissions p
WHERE rp.permission_id=p.id
  AND p.code IN ('maturities.read', 'maturities.write');

DELETE FROM accounting.accounting_permissions
WHERE code IN ('maturities.read', 'maturities.write');

DROP TABLE IF EXISTS accounting.accounting_maturities;
