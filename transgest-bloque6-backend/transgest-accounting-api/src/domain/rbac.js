const ACCOUNTING_MODULE_ID = "contabilidad";

const ROLE_PERMISSIONS = {
  accounting_admin: [
    "accounting.access",
    "accounts.read",
    "accounts.write",
    "audit.read",
    "banks.read",
    "banks.write",
    "company.select",
    "fiscal_years.read",
    "fiscal_years.write",
    "journal.post",
    "journal.read",
    "journal.write",
    "ledger.read",
    "maturities.read",
    "maturities.write",
    "outbox.read",
    "outbox.retry",
    "parties.read",
    "parties.write",
    "periods.read",
    "periods.write",
    "periods.reopen",
    "rbac.read",
    "templates.read",
    "templates.write",
  ],
  accounting_user: [
    "accounting.access",
    "accounts.read",
    "accounts.write",
    "banks.read",
    "banks.write",
    "company.select",
    "fiscal_years.read",
    "fiscal_years.write",
    "journal.post",
    "journal.read",
    "journal.write",
    "ledger.read",
    "maturities.read",
    "maturities.write",
    "parties.read",
    "parties.write",
    "periods.read",
    "periods.write",
    "templates.read",
    "templates.write",
  ],
  accounting_viewer: [
    "accounting.access",
    "accounts.read",
    "banks.read",
    "company.select",
    "fiscal_years.read",
    "journal.read",
    "ledger.read",
    "maturities.read",
    "parties.read",
    "periods.read",
    "templates.read",
  ],
};

function hasTransgestAccountingPermission(permisos, rol) {
  if (rol === "gerente" || rol === "contable") return true;
  const rule = permisos?.modulos?.[ACCOUNTING_MODULE_ID];
  return Boolean(rule?.ver || rule?.editar);
}

function accountingRoleForTransgestRole(rol) {
  if (rol === "gerente") return "accounting_admin";
  if (rol === "contable" || rol === "administrativo") return "accounting_user";
  return "accounting_viewer";
}

function permissionsForRole(roleCode) {
  return ROLE_PERMISSIONS[roleCode] || ROLE_PERMISSIONS.accounting_viewer;
}

function hasPermission(user, permission) {
  if (!user) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes(permission);
}

module.exports = {
  ACCOUNTING_MODULE_ID,
  ROLE_PERMISSIONS,
  accountingRoleForTransgestRole,
  hasPermission,
  hasTransgestAccountingPermission,
  permissionsForRole,
};
