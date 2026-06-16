const config = require("./config");
const { permissionsForRole } = require("../domain/rbac");

function q(name) {
  return `"${config.schema}"."${name}"`;
}

async function ensureRoleAndPermissions(client, roleCode) {
  await client.query(
    `INSERT INTO ${q("accounting_roles")} (code, name, description)
     VALUES ($1,$2,$3)
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, updated_at=NOW()`,
    [roleCode, roleCode.replace(/_/g, " "), "Rol sincronizado desde TransGest"]
  );

  for (const permission of permissionsForRole(roleCode)) {
    await client.query(
      `INSERT INTO ${q("accounting_permissions")} (code, name, description)
       VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, updated_at=NOW()`,
      [permission, permission, "Permiso base de Fase 1"]
    );
    await client.query(
      `INSERT INTO ${q("accounting_role_permissions")} (role_id, permission_id)
       SELECT r.id, p.id
         FROM ${q("accounting_roles")} r, ${q("accounting_permissions")} p
        WHERE r.code=$1 AND p.code=$2
       ON CONFLICT DO NOTHING`,
      [roleCode, permission]
    );
  }
}

async function syncSsoContext(client, payload) {
  const roleCode = payload.accounting_role || "accounting_viewer";
  await ensureRoleAndPermissions(client, roleCode);

  const tenant = await client.query(
    `INSERT INTO ${q("accounting_tenants")} (source_system, source_tenant_id, name)
     VALUES ('transgest', $1, $2)
     ON CONFLICT (source_system, source_tenant_id)
     DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()
     RETURNING *`,
    [payload.tenant_id || payload.empresa_id, payload.tenant_name || payload.empresa_nombre || "TransGest"]
  );

  const company = await client.query(
    `INSERT INTO ${q("accounting_companies")}
       (tenant_id, source_system, source_company_id, legal_name, tax_id, status)
     VALUES ($1, 'transgest', $2, $3, $4, 'active')
     ON CONFLICT (source_system, source_company_id)
     DO UPDATE SET legal_name=EXCLUDED.legal_name, tax_id=EXCLUDED.tax_id, updated_at=NOW()
     RETURNING *`,
    [
      tenant.rows[0].id,
      payload.empresa_id,
      payload.empresa_nombre || "Empresa TransGest",
      payload.empresa_cif || null,
    ]
  );

  const user = await client.query(
    `INSERT INTO ${q("accounting_users")} (source_system, source_user_id, email, display_name, status)
     VALUES ('transgest', $1, $2, $3, 'active')
     ON CONFLICT (source_system, source_user_id)
     DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name, updated_at=NOW()
     RETURNING *`,
    [payload.sub, payload.email || null, payload.nombre || payload.email || "Usuario TransGest"]
  );

  await client.query(
    `INSERT INTO ${q("accounting_user_roles")} (tenant_id, company_id, user_id, role_id)
     SELECT $1, $2, $3, r.id
       FROM ${q("accounting_roles")} r
      WHERE r.code=$4
     ON CONFLICT DO NOTHING`,
    [tenant.rows[0].id, company.rows[0].id, user.rows[0].id, roleCode]
  );

  await client.query(
    `INSERT INTO ${q("audit_log")}
       (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1,$2,'user',$3,'sso.exchange','accounting_user',$3,$4::jsonb)`,
    [
      tenant.rows[0].id,
      company.rows[0].id,
      user.rows[0].id,
      JSON.stringify({ source_user_id: payload.sub, source_role: payload.rol, accounting_role: roleCode }),
    ]
  );

  return { tenant: tenant.rows[0], company: company.rows[0], user: user.rows[0], roleCode };
}

async function loadUserContext(client, userId) {
  const { rows } = await client.query(
    `SELECT u.id, u.source_user_id, u.email, u.display_name,
            c.id AS company_id, c.legal_name AS company_name, c.source_company_id,
            t.id AS tenant_id, t.name AS tenant_name,
            array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL) AS permissions
       FROM ${q("accounting_users")} u
       JOIN ${q("accounting_user_roles")} ur ON ur.user_id=u.id
       JOIN ${q("accounting_companies")} c ON c.id=ur.company_id
       JOIN ${q("accounting_tenants")} t ON t.id=ur.tenant_id
       JOIN ${q("accounting_roles")} r ON r.id=ur.role_id
       LEFT JOIN ${q("accounting_role_permissions")} rp ON rp.role_id=r.id
       LEFT JOIN ${q("accounting_permissions")} p ON p.id=rp.permission_id
      WHERE u.id=$1 AND u.status='active'
      GROUP BY u.id, c.id, t.id
      ORDER BY c.legal_name`,
    [userId]
  );
  return rows;
}

module.exports = { loadUserContext, syncSsoContext };
