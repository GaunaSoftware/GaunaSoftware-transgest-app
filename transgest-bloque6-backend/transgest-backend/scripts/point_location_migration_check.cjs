const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const company = '11111111-1111-4111-8111-111111111111';
  try {
    await db.exec(`CREATE TABLE puntos_interes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL,
      cliente_id UUID, nombre TEXT NOT NULL, direccion TEXT NOT NULL,
      cif TEXT, ciudad TEXT, codigo_postal TEXT, provincia TEXT, pais TEXT,
      lat numeric, lng numeric, tipo TEXT, ventana TEXT, contacto_nombre TEXT,
      contacto_telefono TEXT, email TEXT, notas TEXT, direccion_key TEXT,
      metadata jsonb DEFAULT '{}'::jsonb, clientes_ids uuid[] DEFAULT '{}',
      activo BOOLEAN NOT NULL DEFAULT true, updated_at timestamptz DEFAULT now());
      CREATE FUNCTION tg_point_text(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
        SELECT lower(trim(COALESCE(value,''))) $$;
      CREATE UNIQUE INDEX idx_puntos_interes_empresa_cli_dir ON puntos_interes
        (empresa_id, COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(TRIM(direccion))) WHERE activo=true;
      INSERT INTO puntos_interes (empresa_id,nombre,direccion,ciudad,codigo_postal)
        VALUES ('${company}','Kerahome Tiles, S.A.','Polígono Norte 4','Castellón','12006');`);
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/20260925_point_location_incomplete.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    assert.equal((await db.query("SELECT direccion,location_incomplete FROM puntos_interes WHERE nombre='Kerahome Tiles, S.A.'")).rows[0].direccion, 'Polígono Norte 4');
    assert.equal((await db.query("SELECT location_incomplete FROM puntos_interes WHERE nombre='Kerahome Tiles, S.A.'")).rows[0].location_incomplete, false);
    await db.query('INSERT INTO puntos_interes (empresa_id,nombre,direccion,location_incomplete) VALUES ($1,$2,$3,$4)', [company,'Punto A','',true]);
    await db.query('INSERT INTO puntos_interes (empresa_id,nombre,direccion,location_incomplete) VALUES ($1,$2,$3,$4)', [company,'Punto B','',true]);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM puntos_interes WHERE direccion='' AND empresa_id=$1",[company])).rows[0].total,2);
    await assert.rejects(db.query('INSERT INTO puntos_interes (empresa_id,nombre,direccion) VALUES ($1,$2,$3)',[company,'Duplicado','Polígono Norte 4']), error => error.code === '23505');
    const appDb = require('../src/services/db');
    const originalQuery = appDb.query;
    appDb.query = (sql, params) => db.query(sql, params);
    try {
      global.express = require('express');
      const pointsRouter = require('../src/routes/puntos_interes');
      const handler = (method, route) => pointsRouter.stack.find(layer => layer.route?.path === route && layer.route.methods[method]).route.stack.at(-1).handle;
      const response = () => ({ code:200, status(code){this.code=code;return this;}, json(data){this.data=data;return this;} });
      const create = response();
      await handler('post','/')({empresaId:company,user:{empresa_id:company,rol:'gerente'},body:{nombre:'Kerahome Tiles, S.A. sin dirección',direccion:'',allow_incomplete_location:true}},create);
      assert.equal(create.code,201);
      assert.equal(create.data.direccion,'');
      assert.equal(create.data.location_incomplete,true);
      const withoutConfirmation = response();
      await handler('post','/')({empresaId:company,user:{empresa_id:company,rol:'gerente'},body:{nombre:'Sin confirmar',direccion:''}},withoutConfirmation);
      assert.equal(withoutConfirmation.code,400);
      const foreignUpdate = response();
      const otherCompany = '33333333-3333-4333-8333-333333333333';
      await handler('put','/:id')({empresaId:otherCompany,user:{empresa_id:otherCompany,rol:'gerente'},params:{id:create.data.id},body:{nombre:'Intruso',direccion:'Calle Nueva 5',ciudad:'Castellón',codigo_postal:'12007'}},foreignUpdate);
      assert.equal(foreignUpdate.code,404);
      const update = response();
      await handler('put','/:id')({empresaId:company,user:{empresa_id:company,rol:'gerente'},params:{id:create.data.id},body:{nombre:'Kerahome Tiles, S.A. sin dirección',direccion:'Polígono Sur 5',ciudad:'Castellón',provincia:'Castellón',codigo_postal:'12007',pais:'España'}},update);
      assert.equal(update.code,200);
      assert.equal(update.data.direccion,'Polígono Sur 5');
      assert.equal(update.data.codigo_postal,'12007');
      assert.equal(update.data.location_incomplete,false);
    } finally {
      appDb.query = originalQuery;
    }
    console.log('PASS point location: versioned migration preserves historic addresses and permits separate incomplete points');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
