require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("../src/services/db");

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo1234";
const DEMO_EMAILS = {
  gerente: "gerente@empresa.com",
  trafico: "trafico@empresa.com",
  contable: "contable@empresa.com",
  taller: "taller@empresa.com",
  chofer: "chofer@empresa.com",
  chofer2: "chofer2@empresa.com",
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

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function ensureSchema() {
  await db.query("CREATE EXTENSION IF NOT EXISTS pgcrypto").catch(() => {});
  await db.query("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"").catch(() => {});
  for (const rol of ["administrativo", "responsable_taller", "mecanico", "colaborador"]) {
    await db.query(`ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS '${rol}'`).catch(() => {});
  }

  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfg_precios JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dominio VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'basico'").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'activo'").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS max_vehiculos INTEGER DEFAULT 10").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS max_usuarios INTEGER DEFAULT 5").catch(() => {});

  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS username VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos JSONB").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(() => {});

  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true").catch(() => {});
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS contacto VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS notas TEXT").catch(() => {});
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dias_pago VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS vencimiento VARCHAR(120)").catch(() => {});

  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS apellidos VARCHAR(100)").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS email VARCHAR(180)").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS tipo_contrato VARCHAR(50)").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL").catch(() => {});

  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS clase VARCHAR(100)").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS tipo VARCHAR(80)").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS estado VARCHAR(40) DEFAULT 'disponible'").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS km_actuales INTEGER DEFAULT 0").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS fecha_itv DATE").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS fecha_seguro DATE").catch(() => {});
  await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS notas_operacion TEXT").catch(() => {});

  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS empresa_id UUID").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS cif VARCHAR(50)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS email VARCHAR(255)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS telefono VARCHAR(50)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS iban VARCHAR(50)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS valoracion SMALLINT DEFAULT 5").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS notas TEXT").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS calle VARCHAR(200)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS ciudad VARCHAR(100)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS provincia VARCHAR(100)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS pais VARCHAR(80)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS contacto_nombre VARCHAR(150)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS contacto_telefono VARCHAR(50)").catch(() => {});
  await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(80) DEFAULT 'Transferencia bancaria'").catch(() => {});

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
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS hora_carga VARCHAR(20)").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_entrega DATE").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_descarga DATE").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS puntos_carga JSONB NOT NULL DEFAULT '[]'::jsonb").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS puntos_descarga JSONB NOT NULL DEFAULT '[]'::jsonb").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_precio VARCHAR(50) DEFAULT 'viaje'").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(10,2)").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS km_ruta NUMERIC DEFAULT 0").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS referencia_cliente VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pendiente_completar BOOLEAN DEFAULT false").catch(() => {});

  await db.query(`
    CREATE TABLE IF NOT EXISTS taller_piezas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      almacen_id UUID,
      proveedor VARCHAR(180),
      nombre VARCHAR(180) NOT NULL,
      referencia VARCHAR(120),
      codigo_barras VARCHAR(140),
      categoria VARCHAR(80),
      stock_actual NUMERIC NOT NULL DEFAULT 0,
      stock_minimo NUMERIC NOT NULL DEFAULT 0,
      precio_compra NUMERIC(12,4) NOT NULL DEFAULT 0,
      etiqueta_tamano VARCHAR(40),
      notas TEXT,
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_taller_piezas_empresa_ref ON taller_piezas(empresa_id, referencia)").catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS taller_pieza_unidades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      pieza_id UUID NOT NULL REFERENCES taller_piezas(id) ON DELETE CASCADE,
      codigo_unidad VARCHAR(140) NOT NULL,
      estado VARCHAR(30) NOT NULL DEFAULT 'stock',
      vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
      matricula_snapshot VARCHAR(40),
      intervencion_id UUID,
      precio_unitario NUMERIC(12,4) NOT NULL DEFAULT 0,
      salida_at TIMESTAMPTZ,
      salida_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      notas TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_taller_pieza_unidades_codigo ON taller_pieza_unidades(empresa_id, codigo_unidad)").catch(() => {});
}

async function ensureEmpresa() {
  let empresa = await one(
    "SELECT * FROM empresas WHERE LOWER(email_admin)=LOWER($1) OR dominio='demo' OR LOWER(nombre) IN (LOWER('Empresa Demo S.L.'), LOWER('Transportes Demo S.L.')) LIMIT 1",
    [DEMO_EMAILS.gerente]
  );
  if (!empresa) {
    empresa = await one(
      `INSERT INTO empresas (nombre,cif,email_admin,dominio,plan,estado,max_vehiculos,max_usuarios,ciclo_facturacion,metodo_pago,cfg_precios)
       VALUES ('Empresa Demo S.L.','B12345678',$1,'demo','enterprise','activo',999,999,'mensual','demo','{"demo_mode":true}'::jsonb)
       RETURNING *`,
      [DEMO_EMAILS.gerente]
    );
  } else {
    empresa = await one(
      `UPDATE empresas
          SET nombre='Empresa Demo S.L.',
              email_admin=$2,
              dominio='demo',
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
  const existing = await one("SELECT id FROM usuarios WHERE LOWER(email)=LOWER($1) OR LOWER(username)=LOWER($1) LIMIT 1", [email]);
  if (existing) {
    return one(
      `UPDATE usuarios
          SET empresa_id=$2, nombre=$3, email=$4, username=$4, password_hash=$5, rol=$6, activo=true, chofer_id=$7
        WHERE id=$1
        RETURNING *`,
      [existing.id, empresaId, nombre, email, passwordHash, rol, choferId]
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
  if (existing) {
    return one(
      `UPDATE clientes
          SET nombre=$2,cif=$3,direccion=$4,ciudad=$5,pais='Espana',telefono=$6,email=$7,contacto=$8,
              activo=true,notas='Cliente demo con rutas, puntos y tarifas cargadas',
              forma_pago=$9,dias_pago=$10,vencimiento=$11
        WHERE id=$1
        RETURNING id,nombre`,
      [existing.id, data.nombre, data.cif, data.direccion, data.ciudad, data.telefono, data.email, data.contacto, data.forma_pago, data.dias_pago, data.vencimiento]
    );
  }
  return one(
    `INSERT INTO clientes (empresa_id,nombre,cif,direccion,ciudad,pais,telefono,email,contacto,activo,notas,forma_pago,dias_pago,vencimiento)
     VALUES ($1,$2,$3,$4,$5,'Espana',$6,$7,$8,true,'Cliente demo con rutas, puntos y tarifas cargadas',$9,$10,$11)
     RETURNING id,nombre`,
    [empresaId, data.nombre, data.cif, data.direccion, data.ciudad, data.telefono, data.email, data.contacto, data.forma_pago, data.dias_pago, data.vencimiento]
  );
}

async function ensureColaborador(empresaId, data) {
  const existing = await one(
    "SELECT id FROM colaboradores WHERE (empresa_id=$1 AND LOWER(nombre)=LOWER($2)) OR LOWER(COALESCE(email,''))=LOWER($3) OR cif=$4 LIMIT 1",
    [empresaId, data.nombre, data.email, data.cif]
  );
  if (existing) {
    return one(
      `UPDATE colaboradores
          SET empresa_id=$15,nombre=$2,cif=$3,email=$4,telefono=$5,iban=$6,valoracion=$7,notas=$8,activo=true,
              calle=$9,codigo_postal=$10,ciudad=$11,provincia=$12,pais='Espana',
              contacto_nombre=$13,contacto_telefono=$14,forma_pago='Transferencia bancaria'
        WHERE id=$1
        RETURNING id,nombre`,
      [existing.id, data.nombre, data.cif, data.email, data.telefono, data.iban, data.valoracion, data.notas, data.calle, data.codigo_postal, data.ciudad, data.provincia, data.contacto_nombre, data.contacto_telefono, empresaId]
    );
  }
  return one(
    `INSERT INTO colaboradores
       (empresa_id,nombre,cif,email,telefono,iban,valoracion,notas,activo,calle,codigo_postal,ciudad,provincia,pais,contacto_nombre,contacto_telefono,forma_pago)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,'Espana',$13,$14,'Transferencia bancaria')
     RETURNING id,nombre`,
    [empresaId, data.nombre, data.cif, data.email, data.telefono, data.iban, data.valoracion, data.notas, data.calle, data.codigo_postal, data.ciudad, data.provincia, data.contacto_nombre, data.contacto_telefono]
  );
}

async function ensureChofer(empresaId, data) {
  let chofer = await one(
    "SELECT id FROM choferes WHERE LOWER(COALESCE(email,''))=LOWER($1) OR dni=$2 LIMIT 1",
    [data.email, data.dni]
  );
  if (chofer) {
    chofer = await one(
      `UPDATE choferes
          SET empresa_id=$2,email=$3,nombre=$4,apellidos=$5,dni=$6,telefono=$7,categoria_carnet='C+E',
              tipo_contrato='indefinido',activo=true,notas=$8
        WHERE id=$1
        RETURNING id,nombre,apellidos,email`,
      [chofer.id, empresaId, data.email, data.nombre, data.apellidos, data.dni, data.telefono, data.notas]
    );
  } else {
    chofer = await one(
      `INSERT INTO choferes (empresa_id,nombre,apellidos,dni,telefono,email,categoria_carnet,tipo_contrato,activo,notas)
       VALUES ($1,$2,$3,$4,$5,$6,'C+E','indefinido',true,$7)
       RETURNING id,nombre,apellidos,email`,
      [empresaId, data.nombre, data.apellidos, data.dni, data.telefono, data.email, data.notas]
    );
  }
  return chofer;
}

async function ensureVehiculo(empresaId, data) {
  let veh = await one("SELECT id FROM vehiculos WHERE matricula=$1 LIMIT 1", [data.matricula]);
  if (veh) {
    veh = await one(
      `UPDATE vehiculos
          SET empresa_id=$2,marca=$3,modelo=$4,clase=$5,tipo=$6,km_actuales=$7,chofer_id=$8,activo=true,
              estado=$9,fecha_itv=$10,fecha_seguro=$11,notas_operacion=$12
        WHERE id=$1
        RETURNING id,matricula`,
      [veh.id, empresaId, data.marca, data.modelo, data.clase, data.tipo, data.km_actuales, data.chofer_id, data.estado, data.fecha_itv, data.fecha_seguro, data.notas_operacion]
    );
  } else {
    veh = await one(
      `INSERT INTO vehiculos (empresa_id,matricula,marca,modelo,clase,tipo,km_actuales,chofer_id,activo,estado,fecha_itv,fecha_seguro,notas_operacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12)
       RETURNING id,matricula`,
      [empresaId, data.matricula, data.marca, data.modelo, data.clase, data.tipo, data.km_actuales, data.chofer_id, data.estado, data.fecha_itv, data.fecha_seguro, data.notas_operacion]
    );
  }
  return veh;
}

async function ensureConjunto(empresaId, idx, choferId) {
  const tractor = await ensureVehiculo(empresaId, {
    matricula: `DEMO${String(idx + 1).padStart(2, "0")}TR`,
    marca: idx % 2 ? "Volvo" : "Mercedes",
    modelo: idx % 2 ? "FH 500" : "Actros 1848",
    clase: "tractora",
    tipo: "tractora",
    km_actuales: 180000 + idx * 18450,
    chofer_id: choferId,
    estado: idx === 8 ? "taller" : "disponible",
    fecha_itv: isoDate(180 + idx * 8),
    fecha_seguro: isoDate(220 + idx * 6),
    notas_operacion: "Tractora demo asignada a conjunto.",
  });
  const remolque = await ensureVehiculo(empresaId, {
    matricula: `DEMO${String(idx + 1).padStart(2, "0")}SR`,
    marca: idx % 2 ? "Schmitz" : "Krone",
    modelo: idx % 2 ? "S.CS" : "Profi Liner",
    clase: "semirremolque lona",
    tipo: "remolque",
    km_actuales: 90000 + idx * 7100,
    chofer_id: null,
    estado: "disponible",
    fecha_itv: isoDate(150 + idx * 7),
    fecha_seguro: isoDate(250 + idx * 5),
    notas_operacion: "Remolque demo para conjunto.",
  });
  await db.query("UPDATE vehiculos SET remolque_id=$1 WHERE id=$2 AND empresa_id=$3", [remolque.id, tractor.id, empresaId]);
  if (choferId) await db.query("UPDATE choferes SET vehiculo_id=$1 WHERE id=$2 AND empresa_id=$3", [tractor.id, choferId, empresaId]).catch(() => {});
  return { tractor, remolque };
}

async function ensureRuta(empresaId, clienteId, origen, destino, km, precio) {
  const existing = await one(
    `SELECT id FROM rutas
      WHERE empresa_id=$1 AND cliente_id=$2 AND LOWER(origen)=LOWER($3) AND LOWER(destino)=LOWER($4)
      LIMIT 1`,
    [empresaId, clienteId, origen, destino]
  );
  if (existing) {
    return one(
      `UPDATE rutas SET km=$3,tiempo_h=$4,precio_base=$5,tarifa_tipo='viaje',tipo_vehiculo='tautliner',activa=true,notas='Tarifa demo revisada'
        WHERE id=$1 AND empresa_id=$2
        RETURNING id`,
      [existing.id, empresaId, km, Math.round((km / 82) * 10) / 10, precio]
    );
  }
  return one(
    `INSERT INTO rutas (empresa_id,cliente_id,origen,destino,km,tiempo_h,precio_base,tarifa_tipo,tipo_vehiculo,activa,notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'viaje','tautliner',true,'Tarifa demo revisada')
     RETURNING id`,
    [empresaId, clienteId, origen, destino, km, Math.round((km / 82) * 10) / 10, precio]
  );
}

async function ensurePedido(empresaId, data) {
  const carga = [{ nombre: data.origen, direccion: data.origen, fecha: data.fechaCarga, hora: data.horaCarga, pais: "Espana", provincia: data.origenProvincia || "", google_maps_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(data.origen) }];
  const descarga = [{ nombre: data.destino, direccion: data.destino, fecha: data.fechaEntrega, hora: data.horaDescarga || "17:00", pais: "Espana", provincia: data.destinoProvincia || "", google_maps_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(data.destino) }];
  const existing = await one("SELECT id FROM pedidos WHERE empresa_id=$1 AND numero=$2 LIMIT 1", [empresaId, data.numero]);
  if (existing) {
    return one(
      `UPDATE pedidos SET
         cliente_id=$3,ruta_id=$4,vehiculo_id=$5,remolque_id=$6,chofer_id=$7,colaborador_id=$8,
         origen=$9,destino=$10,fecha_carga=$11,hora_carga=$12,fecha_entrega=$13,fecha_descarga=$13,
         estado=$14,mercancia=$15,peso_kg=$16,bultos=$17,importe=$18,tipo_precio='viaje',precio_unitario=$18,
         km_ruta=$19,referencia_cliente=$20,puntos_carga=$21::jsonb,puntos_descarga=$22::jsonb,
         pendiente_completar=false,notas='Pedido demo activo; no finalizado'
       WHERE id=$1 AND empresa_id=$2
       RETURNING id`,
      [
        existing.id, empresaId, data.clienteId, data.rutaId, data.tractorId, data.remolqueId, data.choferId, data.colaboradorId,
        data.origen, data.destino, data.fechaCarga, data.horaCarga, data.fechaEntrega, data.estado,
        data.mercancia, data.pesoKg, data.bultos, data.importe, data.km, data.referencia,
        JSON.stringify(carga), JSON.stringify(descarga),
      ]
    );
  }
  return one(
    `INSERT INTO pedidos
       (empresa_id,numero,cliente_id,ruta_id,vehiculo_id,remolque_id,chofer_id,colaborador_id,
        origen,destino,fecha_pedido,fecha_carga,hora_carga,fecha_entrega,fecha_descarga,estado,
        mercancia,peso_kg,bultos,importe,tipo_precio,precio_unitario,km_ruta,referencia_cliente,
        puntos_carga,puntos_descarga,pendiente_completar,notas)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_DATE,$11,$12,$13,$13,$14,$15,$16,$17,$18,'viaje',$18,$19,$20,$21::jsonb,$22::jsonb,false,'Pedido demo activo; no finalizado')
     RETURNING id`,
    [
      empresaId, data.numero, data.clienteId, data.rutaId, data.tractorId, data.remolqueId, data.choferId, data.colaboradorId,
      data.origen, data.destino, data.fechaCarga, data.horaCarga, data.fechaEntrega, data.estado,
      data.mercancia, data.pesoKg, data.bultos, data.importe, data.km, data.referencia,
      JSON.stringify(carga), JSON.stringify(descarga),
    ]
  );
}

async function ensurePieza(empresaId, data) {
  const existing = await one("SELECT id FROM taller_piezas WHERE empresa_id=$1 AND referencia=$2 LIMIT 1", [empresaId, data.referencia]);
  const payload = [
    empresaId, data.proveedor, data.nombre, data.referencia, data.codigo_barras,
    data.categoria, data.stock_actual, data.stock_minimo, data.precio_compra, data.etiqueta_tamano, data.notas,
  ];
  let pieza;
  if (existing) {
    pieza = await one(
      `UPDATE taller_piezas
          SET proveedor=$2,nombre=$3,referencia=$4,codigo_barras=$5,categoria=$6,stock_actual=$7,stock_minimo=$8,
              precio_compra=$9,etiqueta_tamano=$10,notas=$11,activo=true,updated_at=NOW()
        WHERE id=$1 AND empresa_id=$12
        RETURNING id,referencia,stock_actual`,
      [existing.id, data.proveedor, data.nombre, data.referencia, data.codigo_barras, data.categoria, data.stock_actual, data.stock_minimo, data.precio_compra, data.etiqueta_tamano, data.notas, empresaId]
    );
  } else {
    pieza = await one(
      `INSERT INTO taller_piezas
        (empresa_id,proveedor,nombre,referencia,codigo_barras,categoria,stock_actual,stock_minimo,precio_compra,etiqueta_tamano,notas,activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       RETURNING id,referencia,stock_actual`,
      payload
    );
  }
  const unidadesObjetivo = Math.min(Number(data.stock_actual || 0), 12);
  for (let i = 1; i <= unidadesObjetivo; i += 1) {
    const codigo = `DEMO-${data.referencia}-${String(i).padStart(3, "0")}`;
    await db.query(
      `INSERT INTO taller_pieza_unidades (empresa_id,pieza_id,codigo_unidad,estado,precio_unitario,notas)
       VALUES ($1,$2,$3,'stock',$4,'Unidad demo en stock')
       ON CONFLICT (empresa_id,codigo_unidad) DO NOTHING`,
      [empresaId, pieza.id, codigo, data.precio_compra]
    ).catch(() => {});
  }
  return pieza;
}

async function main(options = {}) {
  const closePool = options.closePool !== false;
  await ensureSchema();
  const empresa = await ensureEmpresa();
  const empresaId = empresa.id;

  const clientesData = [
    ["Cementos Mediterraneo Demo", "B03000001", "Av. Industria 12", "Alicante", "965000100", "trafico@cementos-demo.local", "Logistica Capa", "Transferencia bancaria", "60 dias fecha factura", 60],
    ["Almacenes Centro Demo", "B28000002", "Calle Mayor 40", "Alcala de Henares", "910000200", "operaciones@centro-demo.local", "Operaciones", "Transferencia bancaria", "30 dias fecha factura", 30],
    ["FrioLevante Distribucion Demo", "B46000003", "Pol. Fuente del Jarro, nave 8", "Paterna", "961000300", "trafico@friolevante-demo.local", "Planificacion", "Confirming", "45 dias fecha factura", 45],
    ["Metalurgicas Norte Demo", "B48000004", "Ribera de Axpe 20", "Erandio", "944000400", "cargas@metalnorte-demo.local", "Expediciones", "Transferencia bancaria", "Al finalizar viaje", 0],
    ["Retail Sur Plataformas Demo", "B41000005", "Avenida Logistica 5", "Dos Hermanas", "955000500", "supply@retailsur-demo.local", "Supply Chain", "Transferencia bancaria", "30 dias fecha recepcion factura", 30],
  ];
  const clientes = [];
  for (const c of clientesData) {
    clientes.push(await ensureCliente(empresaId, {
      nombre: c[0], cif: c[1], direccion: c[2], ciudad: c[3], telefono: c[4], email: c[5], contacto: c[6], forma_pago: c[7], vencimiento: c[8], dias_pago: c[9],
    }));
  }

  const colaboradores = [];
  const colaboradoresData = [
    ["Transiloe Demo, S.L.", "B30000111", "trafico@transiloe-demo.local", "968100100", "ES7600491500051234567892", 5, "Colaborador demo habitual para Levante.", "Calle Transporte 14", "30007", "Murcia", "Murcia", "Sergio Lopez", "608100100"],
    ["Ruta Norte Demo, S.L.", "B48000222", "operaciones@rutanorte-demo.local", "944200200", "ES2100491500059876543210", 4, "Colaborador demo para retornos zona norte.", "Poligono Ibarzaharra 4", "48950", "Erandio", "Bizkaia", "Ane Etxeberria", "608200200"],
    ["Iberica Express Demo, S.A.", "A28000333", "asignaciones@ibericaexpress-demo.local", "910300300", "ES1200491500051928374650", 5, "Colaborador demo para picos de demanda.", "Calle Plataforma 9", "28821", "Coslada", "Madrid", "Carlos Martin", "608300300"],
  ];
  for (const c of colaboradoresData) {
    colaboradores.push(await ensureColaborador(empresaId, {
      nombre: c[0], cif: c[1], email: c[2], telefono: c[3], iban: c[4], valoracion: c[5], notas: c[6], calle: c[7], codigo_postal: c[8], ciudad: c[9], provincia: c[10], contacto_nombre: c[11], contacto_telefono: c[12],
    }));
  }

  const choferes = [];
  const choferesData = [
    ["Pedro", "Sanchez Ruiz", "12345678A", "600111001", "chofer@empresa.com"],
    ["Laura", "Martinez Soler", "12345679B", "600111002", "chofer2@empresa.com"],
    ["Javier", "Moreno Vidal", "12345680C", "600111003", "chofer03@empresa.com"],
    ["Marta", "Navarro Rios", "12345681D", "600111004", "chofer04@empresa.com"],
    ["Andres", "Gil Pardo", "12345682E", "600111005", "chofer05@empresa.com"],
    ["Raul", "Santos Vega", "12345683F", "600111006", "chofer06@empresa.com"],
    ["Nuria", "Lopez Cano", "12345684G", "600111007", "chofer07@empresa.com"],
    ["Ivan", "Ortega Marin", "12345685H", "600111008", "chofer08@empresa.com"],
    ["Elena", "Serrano Alba", "12345686J", "600111009", "chofer09@empresa.com"],
    ["Oscar", "Prieto Mena", "12345687K", "600111010", "chofer10@empresa.com"],
  ];
  for (let i = 0; i < choferesData.length; i += 1) {
    const c = choferesData[i];
    choferes.push(await ensureChofer(empresaId, {
      nombre: c[0], apellidos: c[1], dni: c[2], telefono: c[3], email: c[4], notas: i < 2 ? "Chofer demo con acceso a app." : "Chofer demo sin usuario de app.",
    }));
  }

  const conjuntos = [];
  for (let i = 0; i < 10; i += 1) {
    conjuntos.push(await ensureConjunto(empresaId, i, choferes[i]?.id || null));
  }

  await ensureUser(empresaId, { nombre: "Manuel Gerente Demo", email: DEMO_EMAILS.gerente, rol: "gerente" });
  await ensureUser(empresaId, { nombre: "Trafico Demo", email: DEMO_EMAILS.trafico, rol: "trafico" });
  await ensureUser(empresaId, { nombre: "Contable Demo", email: DEMO_EMAILS.contable, rol: "contable" });
  await ensureUser(empresaId, { nombre: "Responsable Taller Demo", email: DEMO_EMAILS.taller, rol: "responsable_taller" });
  await ensureUser(empresaId, { nombre: "Pedro Chofer Demo", email: DEMO_EMAILS.chofer, rol: "chofer", choferId: choferes[0].id });
  await ensureUser(empresaId, { nombre: "Laura Chofer Demo", email: DEMO_EMAILS.chofer2, rol: "chofer", choferId: choferes[1].id });

  const destinos = [
    ["Plataforma Centro - Getafe", 425, 690, "Madrid"],
    ["Puerto de Valencia - Muelle Norte", 178, 360, "Valencia"],
    ["Centro Logistico Zaragoza", 318, 520, "Zaragoza"],
    ["Poligono Guadalhorce - Malaga", 540, 840, "Malaga"],
    ["Hub Norte - Vitoria", 610, 930, "Alava"],
    ["Parque Empresarial Gandia", 92, 240, "Valencia"],
    ["Terminal Intermodal Barcelona", 515, 860, "Barcelona"],
  ];
  const origenes = ["Alicante", "Alcala de Henares", "Paterna", "Erandio", "Dos Hermanas"];
  const estados = ["pendiente", "confirmado", "en_curso", "descarga", "incidencia", "confirmado", "pendiente"];
  const offsets = [-14, -9, -4, 1, 5, 12, 21];
  let pedidosCreados = 0;
  for (let cIdx = 0; cIdx < clientes.length; cIdx += 1) {
    const cliente = clientes[cIdx];
    for (let j = 0; j < 7; j += 1) {
      const dest = destinos[(cIdx + j) % destinos.length];
      const km = dest[1] + cIdx * 17 + j * 9;
      const precio = money(dest[2] + cIdx * 45 + j * 28);
      const origen = `${clientesData[cIdx][0].replace(" Demo", "")} - ${origenes[cIdx]}`;
      const destino = dest[0];
      const ruta = await ensureRuta(empresaId, cliente.id, origen, destino, km, precio);
      const conjunto = conjuntos[(cIdx * 2 + j) % conjuntos.length];
      const colaborador = j % 4 === 0 ? colaboradores[j % colaboradores.length] : null;
      await ensurePedido(empresaId, {
        numero: `DEMO-${String(cIdx + 1).padStart(2, "0")}-${String(j + 1).padStart(2, "0")}`,
        clienteId: cliente.id,
        rutaId: ruta.id,
        tractorId: colaborador ? null : conjunto.tractor.id,
        remolqueId: colaborador ? null : conjunto.remolque.id,
        choferId: colaborador ? null : choferes[(cIdx * 2 + j) % choferes.length].id,
        colaboradorId: colaborador?.id || null,
        origen,
        destino,
        origenProvincia: origenes[cIdx],
        destinoProvincia: dest[3],
        fechaCarga: isoDate(offsets[j] + cIdx),
        horaCarga: `${String(7 + (j % 5)).padStart(2, "0")}:30`,
        fechaEntrega: isoDate(offsets[j] + cIdx + (km > 500 ? 1 : 0)),
        horaDescarga: `${String(15 + (j % 4)).padStart(2, "0")}:00`,
        estado: estados[j],
        mercancia: ["Palets europeos", "Mercancia general", "Material construccion", "Frio alimentario", "Bobinas metalicas"][cIdx],
        pesoKg: 8000 + cIdx * 2200 + j * 650,
        bultos: 12 + j * 3,
        importe: precio,
        km,
        referencia: `REF-${cIdx + 1}${j + 1}-DEMO`,
      });
      pedidosCreados += 1;
    }
  }

  const piezas = [
    ["FILT-ACE-001", "Filtro aceite tractora", "Filtros", 18, 6, 24.5],
    ["FILT-AIR-002", "Filtro aire cabina", "Filtros", 14, 5, 32.1],
    ["PAST-FRE-003", "Juego pastillas freno eje", "Frenos", 10, 4, 86.75],
    ["CORR-ALT-004", "Correa alternador", "Motor", 8, 3, 41.2],
    ["BOMB-AD-005", "Bomba AdBlue", "AdBlue", 5, 2, 215],
    ["PIL-LED-006", "Piloto LED remolque", "Electricidad", 20, 8, 18.9],
    ["SENS-ABS-007", "Sensor ABS remolque", "Electricidad", 9, 4, 54.4],
    ["NEUM-385-008", "Neumatico 385/65 R22.5", "Neumaticos", 16, 6, 265],
  ];
  for (const p of piezas) {
    await ensurePieza(empresaId, {
      referencia: p[0],
      codigo_barras: `TG-${p[0]}`,
      proveedor: "Proveedor Taller Demo",
      nombre: p[1],
      categoria: p[2],
      stock_actual: p[3],
      stock_minimo: p[4],
      precio_compra: p[5],
      etiqueta_tamano: "standard",
      notas: "Stock demo para pruebas de taller.",
    });
  }

  console.log(JSON.stringify({
    ok: true,
    empresa_id: empresaId,
    demo_mode: true,
    usuarios: DEMO_EMAILS,
    password: DEMO_PASSWORD,
    resumen: {
      clientes: clientes.length,
      choferes: choferes.length,
      tractoras: conjuntos.length,
      remolques: conjuntos.length,
      colaboradores: colaboradores.length,
      pedidos_activos: pedidosCreados,
      piezas_taller: piezas.length,
      usuarios_chofer_app: 2,
    },
  }, null, 2));
  if (closePool) await db.pool.end();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    try { await db.pool.end(); } catch {}
    process.exit(1);
  });
}

module.exports = main;
