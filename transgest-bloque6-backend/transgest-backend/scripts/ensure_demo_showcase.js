require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("../src/services/db");

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo1234";
const DEMO_EMAILS = {
  gerente: "gerente@demo.com",
  trafico: "trafico@demo.com",
  contable: "contable@demo.com",
  chofer: "chofer1@demo.com",
};

async function one(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

function isoDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function ensureSchema() {
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfg_precios JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dominio VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'basico'").catch(() => {});
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS username VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos JSONB").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS apellidos VARCHAR(100)").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS email VARCHAR(180)").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS tipo_contrato VARCHAR(50)").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS clase VARCHAR(100)").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS fecha_itv DATE").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS fecha_seguro DATE").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS km NUMERIC").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tiempo_h NUMERIC").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS precio_base NUMERIC DEFAULT 0").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tarifa_tipo VARCHAR(30) DEFAULT 'viaje'").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tipo_vehiculo VARCHAR(50) DEFAULT 'cualquiera'").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS activa BOOLEAN DEFAULT true").catch(() => {});
  await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS notas TEXT").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ruta_id UUID REFERENCES rutas(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS hora_carga VARCHAR(20)").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_entrega DATE").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_descarga DATE").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS puntos_carga JSONB NOT NULL DEFAULT '[]'::jsonb").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS puntos_descarga JSONB NOT NULL DEFAULT '[]'::jsonb").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_precio VARCHAR(50) DEFAULT 'viaje'").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(10,2)").catch(() => {});
}

async function ensureEmpresa() {
  let empresa = await one(
    "SELECT * FROM empresas WHERE LOWER(email_admin)=LOWER($1) OR dominio='demo' OR LOWER(nombre)=LOWER('Transportes Demo S.L.') LIMIT 1",
    [DEMO_EMAILS.gerente]
  );
  if (!empresa) {
    empresa = await one(
      `INSERT INTO empresas (nombre,cif,email_admin,dominio,plan,estado,max_vehiculos,max_usuarios,ciclo_facturacion,metodo_pago,cfg_precios)
       VALUES ('Transportes Demo S.L.','B12345678',$1,'demo','enterprise','activo',999,999,'mensual','demo','{"demo_mode":true}'::jsonb)
       RETURNING *`,
      [DEMO_EMAILS.gerente]
    );
  } else {
    empresa = await one(
      `UPDATE empresas
          SET nombre=COALESCE(NULLIF(nombre,''),'Transportes Demo S.L.'),
              email_admin=COALESCE(NULLIF(email_admin,''),$2),
              dominio=COALESCE(NULLIF(dominio,''),'demo'),
              plan='enterprise',
              estado='activo',
              max_vehiculos=999,
              max_usuarios=999,
              cfg_precios=jsonb_set(COALESCE(cfg_precios,'{}'::jsonb), '{demo_mode}', 'true'::jsonb, true)
        WHERE id=$1
        RETURNING *`,
      [empresa.id, DEMO_EMAILS.gerente]
    );
  }
  return empresa;
}

async function ensureUser(empresaId, { nombre, email, rol, choferId = null }) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const existing = await one("SELECT id FROM usuarios WHERE empresa_id=$1 AND LOWER(email)=LOWER($2) LIMIT 1", [empresaId, email]);
  if (existing) {
    return one(
      `UPDATE usuarios
          SET nombre=$3, username=$2, password_hash=$4, rol=$5, activo=true, chofer_id=COALESCE($6, chofer_id)
        WHERE id=$1
        RETURNING *`,
      [existing.id, email, nombre, passwordHash, rol, choferId]
    );
  }
  return one(
    `INSERT INTO usuarios (nombre,email,username,password_hash,rol,empresa_id,activo,chofer_id)
     VALUES ($1,$2,$2,$3,$4,$5,true,$6)
     RETURNING *`,
    [nombre, email, passwordHash, rol, empresaId, choferId]
  );
}

async function ensureCliente(empresaId, data) {
  const existing = await one("SELECT id FROM clientes WHERE empresa_id=$1 AND LOWER(nombre)=LOWER($2) LIMIT 1", [empresaId, data.nombre]);
  if (existing) return existing;
  return one(
    `INSERT INTO clientes (empresa_id,nombre,cif,direccion,ciudad,pais,telefono,email,contacto,activo,notas)
     VALUES ($1,$2,$3,$4,$5,'Espana',$6,$7,$8,true,'Cliente demo con rutas y tarifas cargadas')
     RETURNING id`,
    [empresaId, data.nombre, data.cif, data.direccion, data.ciudad, data.telefono, data.email, data.contacto]
  );
}

async function ensureChofer(empresaId) {
  let chofer = await one("SELECT id FROM choferes WHERE empresa_id=$1 AND LOWER(email)=LOWER($2) LIMIT 1", [empresaId, "pedro@demo.com"]);
  if (!chofer) {
    chofer = await one(
      `INSERT INTO choferes (empresa_id,nombre,apellidos,dni,telefono,email,categoria_carnet,tipo_contrato,activo,notas)
       VALUES ($1,'Pedro','Sanchez Ruiz','12345678A','600111222','pedro@demo.com','C+E','indefinido',true,'Chofer principal demo')
       RETURNING id`,
      [empresaId]
    );
  }
  return chofer;
}

async function ensureVehiculo(empresaId, matricula, choferId = null) {
  let veh = await one("SELECT id FROM vehiculos WHERE empresa_id=$1 AND matricula=$2 LIMIT 1", [empresaId, matricula]);
  if (!veh) {
    veh = await one(
      `INSERT INTO vehiculos (empresa_id,matricula,marca,modelo,clase,km_actuales,chofer_id,activo,fecha_itv,fecha_seguro)
       VALUES ($1,$2,'Mercedes','Actros 1848','tractora',248000,$3,true,$4,$5)
       RETURNING id`,
      [empresaId, matricula, choferId, isoDate(320), isoDate(260)]
    );
  }
  return veh;
}

async function ensureRuta(empresaId, clienteId, origen, destino, km, precio) {
  const existing = await one(
    `SELECT id FROM rutas
      WHERE empresa_id=$1 AND cliente_id=$2 AND LOWER(origen)=LOWER($3) AND LOWER(destino)=LOWER($4)
      LIMIT 1`,
    [empresaId, clienteId, origen, destino]
  );
  if (existing) return existing;
  return one(
    `INSERT INTO rutas (empresa_id,cliente_id,origen,destino,km,tiempo_h,precio_base,tarifa_tipo,tipo_vehiculo,activa,notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'viaje','cualquiera',true,'Tarifa demo revisada')
     RETURNING id`,
    [empresaId, clienteId, origen, destino, km, Math.round((km / 82) * 10) / 10, precio]
  );
}

async function ensurePedido(empresaId, data) {
  const existing = await one("SELECT id FROM pedidos WHERE empresa_id=$1 AND numero=$2 LIMIT 1", [empresaId, data.numero]);
  if (existing) return existing;
  return one(
    `INSERT INTO pedidos
       (empresa_id,numero,cliente_id,ruta_id,vehiculo_id,chofer_id,origen,destino,fecha_pedido,fecha_carga,hora_carga,fecha_entrega,fecha_descarga,estado,mercancia,peso_kg,bultos,importe,tipo_precio,precio_unitario,puntos_carga,puntos_descarga,notas)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$9,$10,$11,$11,$12,$13,$14,$15,$16,'viaje',$16,$17::jsonb,$18::jsonb,'Pedido demo completo con DCD')
     RETURNING id`,
    [
      empresaId, data.numero, data.clienteId, data.rutaId, data.vehiculoId, data.choferId,
      data.origen, data.destino, data.fechaCarga, data.horaCarga, data.fechaEntrega, data.estado,
      data.mercancia, data.pesoKg, data.bultos, data.importe,
      JSON.stringify([{ nombre: data.origen, direccion: data.origen, fecha: data.fechaCarga, hora: data.horaCarga, pais: "Espana", google_maps_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(data.origen) }]),
      JSON.stringify([{ nombre: data.destino, direccion: data.destino, fecha: data.fechaEntrega, hora: "17:00", pais: "Espana", google_maps_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(data.destino) }]),
    ]
  );
}

async function main() {
  await ensureSchema();
  const empresa = await ensureEmpresa();
  const empresaId = empresa.id;

  const clienteA = await ensureCliente(empresaId, {
    nombre: "Cementos Mediterraneo Demo",
    cif: "B03000001",
    direccion: "Av. Industria 12",
    ciudad: "Alicante",
    telefono: "965000100",
    email: "trafico@cementos-demo.local",
    contacto: "Logistica Capa",
  });
  const clienteB = await ensureCliente(empresaId, {
    nombre: "Almacenes Centro Demo",
    cif: "B28000002",
    direccion: "Calle Mayor 40",
    ciudad: "Alcala de Henares",
    telefono: "910000200",
    email: "operaciones@centro-demo.local",
    contacto: "Operaciones",
  });

  const chofer = await ensureChofer(empresaId);
  const vehiculo = await ensureVehiculo(empresaId, "1234ABC", chofer.id);
  await ensureVehiculo(empresaId, "5678DEF", null);

  await ensureUser(empresaId, { nombre: "Gerente Demo", email: DEMO_EMAILS.gerente, rol: "gerente" });
  await ensureUser(empresaId, { nombre: "Trafico Demo", email: DEMO_EMAILS.trafico, rol: "trafico" });
  await ensureUser(empresaId, { nombre: "Contable Demo", email: DEMO_EMAILS.contable, rol: "contable" });
  await ensureUser(empresaId, { nombre: "Pedro Chofer Demo", email: DEMO_EMAILS.chofer, rol: "chofer", choferId: chofer.id });

  const rutaA = await ensureRuta(empresaId, clienteA.id, "Cementos Mediterraneo - Alicante", "Obra Norte - Madrid", 420, 680);
  const rutaB = await ensureRuta(empresaId, clienteB.id, "Almacenes Centro - Alcala", "Plataforma Levante - Valencia", 360, 540);
  const rutaC = await ensureRuta(empresaId, clienteA.id, "Puerto de Alicante", "Cliente final - Murcia", 82, 210);

  await ensurePedido(empresaId, { numero: "DEMO-DCD-001", clienteId: clienteA.id, rutaId: rutaA.id, vehiculoId: vehiculo.id, choferId: chofer.id, origen: "Cementos Mediterraneo - Alicante", destino: "Obra Norte - Madrid", fechaCarga: isoDate(0), horaCarga: "08:00", fechaEntrega: isoDate(1), estado: "confirmado", mercancia: "Palets de cemento", pesoKg: 24000, bultos: 33, importe: 680 });
  await ensurePedido(empresaId, { numero: "DEMO-DCD-002", clienteId: clienteB.id, rutaId: rutaB.id, vehiculoId: vehiculo.id, choferId: chofer.id, origen: "Almacenes Centro - Alcala", destino: "Plataforma Levante - Valencia", fechaCarga: isoDate(2), horaCarga: "09:30", fechaEntrega: isoDate(2), estado: "en_curso", mercancia: "Mercancia general paletizada", pesoKg: 12000, bultos: 18, importe: 540 });
  await ensurePedido(empresaId, { numero: "DEMO-DCD-003", clienteId: clienteA.id, rutaId: rutaC.id, vehiculoId: null, choferId: null, origen: "Puerto de Alicante", destino: "Cliente final - Murcia", fechaCarga: isoDate(4), horaCarga: "07:30", fechaEntrega: isoDate(4), estado: "pendiente", mercancia: "Grupaje paletizado", pesoKg: 6000, bultos: 8, importe: 210 });

  console.log(JSON.stringify({
    ok: true,
    empresa_id: empresaId,
    demo_mode: true,
    usuarios: DEMO_EMAILS,
    password: DEMO_PASSWORD,
  }, null, 2));
  await db.pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.pool.end(); } catch {}
  process.exit(1);
});
