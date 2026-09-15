const quote = name => '"' + String(name).replace(/"/g, '""') + '"';
function problem(status, message) { return Object.assign(new Error(message), { status }); }

async function deleteCompany(db, empresaId, confirmation) {
  return db.transaction(async client => {
    const { rows } = await client.query('SELECT id,nombre,estado FROM empresas WHERE id=$1 FOR UPDATE', [empresaId]);
    const company = rows[0];
    if (!company) throw problem(404, 'Empresa no encontrada');
    if (company.estado !== 'cancelado') throw problem(409, 'Cancela la empresa antes de eliminarla definitivamente.');
    if (String(confirmation || '').trim() !== String(company.nombre || '').trim()) {
      throw problem(400, 'El nombre de confirmación no coincide con el de la empresa.');
    }

    // Include legacy tables without a cascading FK, but never views or another schema.
    const { rows: tables } = await client.query(`
      SELECT c.table_name, c.is_nullable FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
      WHERE c.table_schema='public' AND c.column_name='empresa_id' AND t.table_type='BASE TABLE'
      ORDER BY c.table_name`);
    let pending = tables.filter(t => t.table_name !== 'empresas');
    // Savepoints let us retry parents after their children without leaving a failed transaction.
    while (pending.length) {
      const blocked = [];
      for (const table of pending) {
        await client.query('SAVEPOINT company_delete_step');
        try {
          const name = quote(table.table_name);
          const isAudit = /audit/i.test(table.table_name);
          if (isAudit) {
            if (table.is_nullable !== 'YES') {
              const { rows: remaining } = await client.query(`SELECT 1 FROM public.${name} WHERE empresa_id=$1 LIMIT 1`, [empresaId]);
              if (remaining.length) throw problem(409, 'El registro de auditoría impide eliminar esta empresa. No se ha borrado ningún dato.');
            } else {
              // Retain audit records instead of deleting the history of the operation.
              await client.query(`UPDATE public.${name} SET empresa_id=NULL WHERE empresa_id=$1`, [empresaId]);
            }
          } else {
            await client.query(`DELETE FROM public.${name} WHERE empresa_id=$1`, [empresaId]);
          }
          await client.query('RELEASE SAVEPOINT company_delete_step');
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT company_delete_step');
          await client.query('RELEASE SAVEPOINT company_delete_step');
          if (error.code !== '23503') throw error;
          blocked.push(table);
        }
      }
      if (blocked.length === pending.length) {
        throw problem(409, 'Hay datos vinculados que impiden eliminar la empresa. No se ha borrado ningún dato. Tablas pendientes: ' + blocked.map(t => t.table_name).join(', '));
      }
      pending = blocked;
    }
    await client.query('DELETE FROM empresas WHERE id=$1', [empresaId]);
    return { ok: true, deleted: company.nombre };
  });
}
module.exports = { deleteCompany };
