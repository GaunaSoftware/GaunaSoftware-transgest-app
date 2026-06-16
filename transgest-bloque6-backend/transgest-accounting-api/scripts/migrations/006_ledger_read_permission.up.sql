INSERT INTO accounting.accounting_roles (code, name, description)
VALUES
  ('accounting_admin', 'Administrador contable', 'Rol base de administracion contable'),
  ('accounting_user', 'Usuario contable', 'Rol base de operacion contable'),
  ('accounting_viewer', 'Lector contable', 'Rol base de consulta contable')
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounting.accounting_permissions (code, name, description)
VALUES ('ledger.read', 'ledger.read', 'Permite consultar Mayor y balance de sumas y saldos')
ON CONFLICT (code) DO UPDATE
  SET name=EXCLUDED.name,
      description=EXCLUDED.description;

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='ledger.read'
 WHERE r.code IN ('accounting_admin', 'accounting_user', 'accounting_viewer')
ON CONFLICT DO NOTHING;
