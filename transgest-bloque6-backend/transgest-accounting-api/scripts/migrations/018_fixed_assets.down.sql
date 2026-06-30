DELETE FROM accounting.accounting_role_permissions rp
USING accounting.accounting_permissions p
WHERE rp.permission_id=p.id
  AND p.code IN ('fixed_assets.read', 'fixed_assets.write');

DELETE FROM accounting.accounting_permissions
WHERE code IN ('fixed_assets.read', 'fixed_assets.write');

DROP TABLE IF EXISTS accounting.accounting_fixed_assets;
