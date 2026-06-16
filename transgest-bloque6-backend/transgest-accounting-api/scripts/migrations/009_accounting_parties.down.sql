DELETE FROM accounting.accounting_role_permissions rp
USING accounting.accounting_permissions p
WHERE rp.permission_id=p.id
  AND p.code IN ('parties.read', 'parties.write');

DELETE FROM accounting.accounting_permissions
WHERE code IN ('parties.read', 'parties.write');

DROP TABLE IF EXISTS accounting.accounting_parties;
