// ══════════════════════════════════════════════════════
// src/services/paginate.js — Paginación estándar
// ══════════════════════════════════════════════════════

/**
 * Extrae parámetros de paginación del request
 * @returns { page, limit, offset }
 */
function getPaginationParams(req, defaultLimit = 50) {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Construye la respuesta paginada estándar
 */
function paginatedResponse(rows, total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  return {
    data:       rows,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Ejecuta query paginada en la BD
 * @param db        - instancia de db
 * @param baseQuery - query sin LIMIT/OFFSET/ORDER
 * @param params    - parámetros de la query
 * @param { page, limit, offset, orderBy }
 */
async function paginateQuery(db, baseQuery, params, { page, limit, offset, orderBy = "" }) {
  // Count total
  const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) AS _count_q`;
  const { rows: countRows } = await db.query(countQuery, params);
  const total = parseInt(countRows[0].count);

  // Fetch page
  const dataQuery = `${baseQuery} ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const { rows } = await db.query(dataQuery, [...params, limit, offset]);

  return paginatedResponse(rows, total, page, limit);
}

module.exports = { getPaginationParams, paginatedResponse, paginateQuery };
