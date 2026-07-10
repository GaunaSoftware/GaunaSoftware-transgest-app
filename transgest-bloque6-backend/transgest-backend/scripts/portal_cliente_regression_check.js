const assert = require("node:assert/strict");
const portalRouter = require("../src/routes/cliente_portal");

const {
  asyncRoute,
  nextPedidoNumero,
  normalizeNonNegativeNumeric,
  normalizePositiveInteger,
  portalPointLabel,
  portalPointStop,
  resolveSolicitudImporte,
} = portalRouter._test;

async function run() {
  assert.equal(normalizeNonNegativeNumeric(-1), null);
  assert.equal(normalizeNonNegativeNumeric("125,50"), 125.5);
  assert.equal(normalizePositiveInteger(-1), null);
  assert.equal(normalizePositiveInteger("8"), 8);
  assert.equal(resolveSolicitudImporte({}), 0);
  assert.equal(resolveSolicitudImporte({ importe: -1 }), 0);
  assert.equal(resolveSolicitudImporte({ importe: "325,40" }), 325.4);
  assert.equal(resolveSolicitudImporte({ decision_precio: "aceptada", importe_contraoferta: "410" }), 410);

  const point = {
    id: "point-1",
    nombre: "Almacen QA",
    direccion: "Avenida QA 1",
    ciudad: "Alicante",
    provincia: "Alicante",
    pais: "Espana",
    lat: 38.34,
    lng: -0.48,
  };
  assert.equal(portalPointLabel(point), "Almacen QA - Avenida QA 1 - Alicante");
  assert.deepEqual(
    portalPointStop(point, "", "carga", "2026-07-10", "08:00"),
    {
      punto_id: "point-1",
      nombre: "Almacen QA",
      direccion: "Avenida QA 1",
      poblacion: "Alicante",
      provincia: "Alicante",
      pais: "Espana",
      lat: 38.34,
      lng: -0.48,
      ventana: "",
      fecha: "2026-07-10",
      hora: "08:00",
      tipo: "carga",
    }
  );

  const queries = [];
  const fakeClient = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/UPDATE pedido_numero_counters/i.test(sql)) return { rows: [{ last_num: 42 }] };
      return { rows: [] };
    },
  };
  const year = new Date().getFullYear();
  assert.equal(await nextPedidoNumero(fakeClient, "empresa-qa"), `PED-${year}-0042`);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /GREATEST\(pedido_numero_counters\.last_num, EXCLUDED\.last_num\)/);
  assert.equal(queries[0].params[0], "empresa-qa");
  assert.equal(queries[0].params[3], `PED-${year}-%`);

  const marker = new Error("qa async route");
  await new Promise((resolve, reject) => {
    asyncRoute(async () => { throw marker; })({}, {}, error => {
      try {
        assert.equal(error, marker);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });

  console.log("OK portal cliente regression check");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
