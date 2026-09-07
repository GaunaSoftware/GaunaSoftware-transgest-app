function foldPointText(value = "") {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function pointIdentity(point = {}) {
  return [point.direccion, point.ciudad, point.provincia, point.pais || "Espana"].map(foldPointText).join("|");
}

async function ensurePointIdentitySchema(db) {
  await db.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('transgest:point-identity-v2'))");
    await client.query(`CREATE OR REPLACE FUNCTION tg_point_text(value text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT trim(regexp_replace(translate(lower(COALESCE(value,'')),
          'áàäâãåéèëêíìïîóòöôõúùüûñç', 'aaaaaaeeeeiiiiooooouuuunc'), '[^a-z0-9]+', ' ', 'g'))
      $$`);
    // The index also protects concurrent writes, including writes from older clients.
    await client.query("LOCK TABLE puntos_interes IN SHARE ROW EXCLUSIVE MODE");
    await client.query("ALTER TABLE puntos_interes ADD COLUMN IF NOT EXISTS clientes_ids UUID[] DEFAULT '{}'");
    for (const name of ["idx_puntos_interes_empresa_dir", "idx_puntos_interes_empresa_cliente_dir", "idx_puntos_interes_empresa_cli_dir", "idx_puntos_interes_empresa_cli_dir_key"]) {
      await client.query(`DROP INDEX IF EXISTS ${name}`);
    }
    await client.query(`WITH ranked AS (
      SELECT id, FIRST_VALUE(id) OVER (PARTITION BY empresa_id,
        COALESCE(cliente_id,'00000000-0000-0000-0000-000000000000'::uuid),
        tg_point_text(direccion), tg_point_text(ciudad), tg_point_text(provincia), tg_point_text(COALESCE(NULLIF(trim(pais),''),'Espana'))
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC) AS survivor
      FROM puntos_interes WHERE activo=true AND tg_point_text(direccion) <> ''
    ), memberships AS (
      SELECT r.survivor, ARRAY_AGG(DISTINCT linked.cliente_id) AS clientes_ids
      FROM ranked r JOIN puntos_interes p ON p.id=r.id
      CROSS JOIN LATERAL unnest(p.clientes_ids) AS linked(cliente_id)
      GROUP BY r.survivor
    ) UPDATE puntos_interes p SET clientes_ids=m.clientes_ids FROM memberships m WHERE p.id=m.survivor`);
    await client.query(`WITH duplicates AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY empresa_id,
        COALESCE(cliente_id,'00000000-0000-0000-0000-000000000000'::uuid),
        tg_point_text(direccion), tg_point_text(ciudad), tg_point_text(provincia), tg_point_text(COALESCE(NULLIF(trim(pais),''),'Espana'))
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC) AS position
      FROM puntos_interes WHERE activo=true AND tg_point_text(direccion) <> ''
    ) UPDATE puntos_interes p SET activo=false, updated_at=NOW(),
        notas=CONCAT_WS(E'\\n',NULLIF(p.notas,''),'Duplicado de la misma ubicacion desactivado; se conserva el historial.')
      FROM duplicates d WHERE p.id=d.id AND d.position>1`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_puntos_interes_ubicacion_v2
      ON puntos_interes (empresa_id, COALESCE(cliente_id,'00000000-0000-0000-0000-000000000000'::uuid),
        tg_point_text(direccion), tg_point_text(ciudad), tg_point_text(provincia), tg_point_text(COALESCE(NULLIF(trim(pais),''),'Espana')))
      WHERE activo=true AND tg_point_text(direccion) <> ''`);
  });
}

module.exports = { foldPointText, pointIdentity, ensurePointIdentitySchema };
