// ══════════════════════════════════════════════════════
// scripts/seed.js — Datos de demostración
// Crea empresa, usuarios, vehículos, clientes y pedidos
// Solo se ejecuta si la empresa demo no existe ya
// ══════════════════════════════════════════════════════
require("dotenv").config();
const db     = require("../src/services/db");
const bcrypt = require("bcryptjs");

const EMPRESA_NOMBRE = "Transportes Demo S.L.";
const PASS_HASH_CACHE = {};

async function hash(pw) {
  if (!PASS_HASH_CACHE[pw]) PASS_HASH_CACHE[pw] = await bcrypt.hash(pw, 10);
  return PASS_HASH_CACHE[pw];
}

async function seed() {
  console.log("\n🌱 TransGest TMS — Seed de demostración");
  console.log("━".repeat(45));

  // ── 0. Check si ya existe ──────────────────────────
  const { rows: existing } = await db.query(
    "SELECT id FROM empresas WHERE nombre = $1", [EMPRESA_NOMBRE]
  );
  if (existing.length > 0) {
    console.log("✅ Los datos de demo ya existen. Nada que hacer.");
    console.log("\n   Credenciales:");
    console.log("   gerente@demo.com / demo1234");
    console.log("   trafico@demo.com / demo1234");
    console.log("   contable@demo.com / demo1234");
    process.exit(0);
  }

  // ── 1. Empresa ─────────────────────────────────────
  console.log("\n📦 Creando empresa...");
  const { rows: [empresa] } = await db.query(`
    INSERT INTO empresas (nombre, cif, direccion, ciudad, pais, telefono, email)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
  `, [EMPRESA_NOMBRE, "B12345678", "Calle Mayor 15, 2º",
      "Madrid", "España", "+34 91 123 45 67", "info@transportesdemo.com"]);
  const eid = empresa.id;
  console.log(`   ✅ Empresa creada (id: ${eid})`);

  // ── 2. Usuarios ────────────────────────────────────
  console.log("\n👤 Creando usuarios...");
  const pw = await hash("demo1234");
  const usuarios = [
    ["Carlos García", "gerente@demo.com",   "gerente"],
    ["María López",  "trafico@demo.com",    "trafico"],
    ["Ana Martín",   "contable@demo.com",   "contable"],
    ["Pedro Sánchez","chofer1@demo.com",     "chofer"],
  ];
  const userIds = {};
  for (const [nombre, email, rol] of usuarios) {
    const { rows: [u] } = await db.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol, empresa_id, activo)
      VALUES ($1,$2,$3,$4,$5,true) RETURNING id
    `, [nombre, email, pw, rol, eid]);
    userIds[rol] = u.id;
    console.log(`   ✅ ${nombre} (${rol})`);
  }

  // ── 3. Chóferes ────────────────────────────────────
  console.log("\n🧑‍✈️ Creando chóferes...");
  const choferes = [
    ["Pedro",   "Sánchez Ruiz",    "12345678A", "+34 600 111 222", "pedro@demo.com",  "C+E"],
    ["Miguel",  "Torres González", "87654321B", "+34 600 333 444", "miguel@demo.com", "C+E"],
    ["Laura",   "Díaz Fernández",  "11223344C", "+34 600 555 666", "laura@demo.com",  "C"],
  ];
  const choferIds = [];
  for (const [nombre, apellidos, dni, tel, email, carnet] of choferes) {
    const { rows: [ch] } = await db.query(`
      INSERT INTO choferes (nombre, apellidos, dni, telefono, email, tipo_carnet, empresa_id, activo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id
    `, [nombre, apellidos, dni, tel, email, carnet, eid]);
    choferIds.push(ch.id);
    console.log(`   ✅ ${nombre} ${apellidos}`);
  }

  // ── 4. Vehículos ───────────────────────────────────
  console.log("\n🚛 Creando vehículos...");
  const hoy = new Date();
  const en1año  = new Date(hoy); en1año.setFullYear(hoy.getFullYear()+1);
  const en8m    = new Date(hoy); en8m.setMonth(hoy.getMonth()+8);
  const vencida = new Date(hoy); vencida.setMonth(hoy.getMonth()-1);

  const vehiculos = [
    ["1234 ABC", "Mercedes", "Actros 1848",    "tractora", 248000, en1año, en8m,   choferIds[0]],
    ["5678 DEF", "Volvo",    "FH 500",          "tractora", 312000, en8m,   en1año, choferIds[1]],
    ["9999 REM", "Schmitz",  "S.KO 27",         "remolque", 150000, en1año, en1año, null],
    ["3333 REM", "Krone",    "SD 27 Ecoliner",  "remolque", 88000,  en1año, vencida,null],
  ];
  const vehiculoIds = [];
  for (const [matricula, marca, modelo, clase, km, itv, seguro, chofer_id] of vehiculos) {
    const { rows: [v] } = await db.query(`
      INSERT INTO vehiculos (matricula, marca, modelo, clase, km_actuales,
        fecha_itv, fecha_seguro, chofer_id, empresa_id, activo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id
    `, [matricula, marca, modelo, clase, km,
        itv.toISOString().slice(0,10), seguro.toISOString().slice(0,10),
        chofer_id, eid]);
    vehiculoIds.push(v.id);
    console.log(`   ✅ ${matricula} — ${marca} ${modelo}`);
  }

  // ── 5. Clientes ────────────────────────────────────
  console.log("\n🏢 Creando clientes...");
  const clientes = [
    ["ACME Distribución S.L.",  "B98765432", "Madrid",    "España",  "+34 91 234 56 78", "pedidos@acme.com",    "21"],
    ["Bergé Marítima S.A.",     "A11223344", "Barcelona", "España",  "+34 93 345 67 89", "logistica@berge.com", "21"],
    ["Export GmbH",             "DE123456789","Hamburg",  "Alemania","+49 40 123 456",   "freight@export.de",   "exento"],
    ["Logística Norte S.L.",    "B55667788", "Bilbao",    "España",  "+34 94 456 78 90", "info@lognorte.com",   "21"],
  ];
  const clienteIds = [];
  for (const [nombre, cif, ciudad, pais, tel, email, iva] of clientes) {
    const { rows: [cl] } = await db.query(`
      INSERT INTO clientes (nombre, cif, ciudad, pais, telefono, email, tipo_iva, empresa_id, activo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id
    `, [nombre, cif, ciudad, pais, tel, email, iva, eid]);
    clienteIds.push(cl.id);
    console.log(`   ✅ ${nombre}`);
  }

  // ── 6. Rutas ───────────────────────────────────────
  console.log("\n🗺️  Creando rutas...");
  const rutas = [
    ["Madrid", "Barcelona",  620, 6.5,  850],
    ["Madrid", "Bilbao",     395, 4.0,  680],
    ["Madrid", "Valencia",   355, 3.5,  520],
    ["Barcelona","Hamburg",  1850,18.0, 2400],
  ];
  const rutaIds = [];
  for (const [origen, destino, km, horas, precio] of rutas) {
    const { rows: [r] } = await db.query(`
      INSERT INTO rutas (origen, destino, km_estimados, horas_estimadas, precio_base, empresa_id, activo)
      VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id
    `, [origen, destino, km, horas, precio, eid]);
    rutaIds.push(r.id);
    console.log(`   ✅ ${origen} → ${destino} (${km}km)`);
  }

  // ── 7. Pedidos demo (últimas 4 semanas + próximas 2) ───
  console.log("\n📦 Creando pedidos de demo...");

  const d = (offsetDays) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + offsetDays);
    return dt.toISOString().slice(0,10);
  };

  const pedidosSeed = [
    // [numero, cliente_idx, ruta_idx, vehiculo_idx, chofer_idx, f_carga, f_entrega, estado, mercancia, peso, importe, coste_gasoil, coste_peajes]
    ["TMS-001", 0, 0, 0, 0, d(-21), d(-20), "entregado",  "Palets electrónica",  18000, 850,  120, 45],
    ["TMS-002", 1, 1, 1, 1, d(-18), d(-17), "facturado",  "Maquinaria industrial",24000, 980,  95, 38],
    ["TMS-003", 2, 3, 0, 0, d(-14), d(-12), "entregado",  "Autopartes exportación",20000,2400, 380, 180],
    ["TMS-004", 3, 2, 1, 1, d(-10), d(-9),  "entregado",  "Alimentación congelada",22000, 720, 88, 32],
    ["TMS-005", 0, 0, 0, 0, d(-7),  d(-6),  "entregado",  "Material construcción", 26000, 900, 115, 42],
    ["TMS-006", 1, 1, 1, 1, d(-5),  d(-4),  "facturado",  "Componentes auto",      19000, 750, 92, 36],
    ["TMS-007", 3, 2, 0, 2, d(-3),  d(-2),  "en_curso",   "Mercancias generales",  15000, 640, 78, 28],
    ["TMS-008", 0, 0, 1, 1, d(-1),  d(0),   "en_curso",   "Palets retail",         21000, 870, 108, 41],
    ["TMS-009", 1, 1, 0, 0, d(1),   d(2),   "confirmado", "Maquinaria pesada",     24500, 1100,0,  0],
    ["TMS-010", 2, 3, 1, 1, d(3),   d(5),   "confirmado", "Exportación química",   18000, 2200,0,  0],
    ["TMS-011", 3, 2, 0, 2, d(5),   d(6),   "pendiente",  "Alimentación seca",     16000, 580, 0,  0],
    ["TMS-012", 0, 0, 1, 1, d(7),   d(8),   "pendiente",  "Material eléctrico",    20000, 920, 0,  0],
  ];

  for (const [num, cli, ruta, veh, cho, fc, fe, estado, mercan, peso, importe, gasoil, peajes] of pedidosSeed) {
    const { rows: [ruta_row] } = await db.query("SELECT origen, destino, km_estimados FROM rutas WHERE id=$1", [rutaIds[ruta]]);
    await db.query(`
      INSERT INTO pedidos (
        numero, cliente_id, ruta_id, vehiculo_id, chofer_id,
        origen, destino, fecha_carga, fecha_entrega, estado,
        mercancia, peso_kg, importe,
        coste_gasoil, coste_peajes,
        empresa_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [num, clienteIds[cli], rutaIds[ruta], vehiculoIds[veh], choferIds[cho],
        ruta_row.origen, ruta_row.destino, fc, fe, estado,
        mercan, peso, importe, gasoil, peajes, eid]);
    console.log(`   ✅ ${num} — ${ruta_row.origen}→${ruta_row.destino} [${estado}]`);
  }

  // ── 8. Crear 2 facturas de demo ────────────────────
  console.log("\n🧾 Creando facturas de demo...");
  const { rows: facturables } = await db.query(
    "SELECT id, cliente_id, importe FROM pedidos WHERE empresa_id=$1 AND estado IN ('entregado','facturado') LIMIT 4",
    [eid]
  );
  if (facturables.length >= 2) {
    const grupo1 = facturables.slice(0,2);
    const base1  = grupo1.reduce((s,p)=>s+Number(p.importe),0);
    const iva1   = base1 * 0.21;
    const { rows: [f1] } = await db.query(`
      INSERT INTO facturas (numero, cliente_id, empresa_id, fecha, estado,
        base_imponible, iva_pct, iva_importe, total)
      VALUES ($1,$2,$3,CURRENT_DATE,'cobrada',$4,21,$5,$6) RETURNING id
    `, [`F-${new Date().getFullYear()}-001`, grupo1[0].cliente_id, eid,
        base1, iva1, base1+iva1]);
    for (const p of grupo1) {
      await db.query("UPDATE pedidos SET factura_id=$1, facturado=true, estado='facturado' WHERE id=$2",
        [f1.id, p.id]);
    }
    console.log(`   ✅ F-${new Date().getFullYear()}-001 — ${(base1+iva1).toFixed(2)}€ (cobrada)`);

    if (facturables.length >= 4) {
      const grupo2 = facturables.slice(2,4);
      const base2  = grupo2.reduce((s,p)=>s+Number(p.importe),0);
      const iva2   = base2 * 0.21;
      const { rows: [f2] } = await db.query(`
        INSERT INTO facturas (numero, cliente_id, empresa_id, fecha, estado,
          base_imponible, iva_pct, iva_importe, total)
        VALUES ($1,$2,$3,CURRENT_DATE,'emitida',$4,21,$5,$6) RETURNING id
      `, [`F-${new Date().getFullYear()}-002`, grupo2[0].cliente_id, eid,
          base2, iva2, base2+iva2]);
      for (const p of grupo2) {
        await db.query("UPDATE pedidos SET factura_id=$1, facturado=true, estado='facturado' WHERE id=$2",
          [f2.id, p.id]);
      }
      console.log(`   ✅ F-${new Date().getFullYear()}-002 — ${(base2+iva2).toFixed(2)}€ (emitida)`);
    }
  }

  // ── RESUMEN ────────────────────────────────────────
  console.log("\n" + "━".repeat(45));
  console.log("✅ Seed completado con éxito\n");
  console.log("📋 Credenciales de acceso:");
  console.log("   gerente@demo.com  / demo1234  (acceso total)");
  console.log("   trafico@demo.com  / demo1234  (pedidos + cuadrante)");
  console.log("   contable@demo.com / demo1234  (facturas + informes)");
  console.log("   chofer1@demo.com  / demo1234  (app chófer)\n");
  console.log("🌐 Accede en: http://localhost\n");

  await db.pool.end();
  process.exit(0);
}

seed().catch(err => {
  console.error("\n❌ Error en seed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
