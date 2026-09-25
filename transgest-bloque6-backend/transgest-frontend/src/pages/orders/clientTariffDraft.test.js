import { clearCustomerTariffDraft, hasCustomerDependentValues, recoverExistingTripPrice, routesForCustomer, switchCustomerDraft } from "./clientTariffDraft";

test("quitar cliente vacía tarifa, precio y condiciones del pedido sin tocar maestros ni mercancía", () => {
  const customerA = { id: "a", nombre: "Cliente A", horario_carga: "08:00-12:00" };
  const draft = {
    cliente_id: customerA.id, cliente_nombre: customerA.nombre, ruta_id: "tarifa-a",
    tipo_precio: "tonelada", precio_unitario: 32, precio_base_sin_combustible: 30,
    recargo_combustible_pct: 6.67, importe_revision_combustible: 2,
    importe_minimo: 200, minimo_unidades: 20, precio_cliente_col: 900,
    importe: 950, referencia_cliente: "OC-A", ventana_carga: "08:00-12:00",
    ventana_descarga: "10:00-16:00", tipo_iva: 10, iva_regimen: "general",
    mercancia: "Azulejos", peso_kg: 1000, puntos_carga: [{ id: "p1" }],
  };
  expect(hasCustomerDependentValues(draft)).toBe(true);
  const cleared = clearCustomerTariffDraft(draft);
  expect(cleared).toMatchObject({
    cliente_id: "", cliente_nombre: "", ruta_id: "", referencia_cliente: "",
    tipo_precio: "viaje", precio_unitario: "", precio_base_sin_combustible: "",
    recargo_combustible_pct: "", importe_revision_combustible: "",
    importe_minimo: "", minimo_unidades: "", precio_cliente_col: "", importe: "",
    ventana_carga: "", ventana_descarga: "", tipo_iva: "", iva_regimen: "",
    mercancia: "Azulejos", peso_kg: 1000,
  });
  expect(cleared.puntos_carga).toEqual([{ id: "p1" }]);
  expect(customerA).toEqual({ id: "a", nombre: "Cliente A", horario_carga: "08:00-12:00" });
});

test("cambiar cliente no arrastra tarifa ni referencia del cliente anterior", () => {
  const switched = switchCustomerDraft({
    cliente_id: "a", ruta_id: "tarifa-a", precio_unitario: 100, referencia_cliente: "A-123",
    ventana_carga: "08:00", ventana_descarga: "12:00", mercancia: "Carga manual",
  }, { id: "b", tipo_iva: 21, iva_regimen: "general", horario_carga: "14:00", horario_descarga: "18:00" });
  expect(switched).toMatchObject({
    cliente_id: "b", ruta_id: "", precio_unitario: "", referencia_cliente: "",
    ventana_carga: "14:00", ventana_descarga: "18:00", mercancia: "Carga manual",
    tipo_iva: 21,
  });
});

test("las rutas recibidas al abrir el editor solo muestran las del cliente actual", () => {
  const routes = [{ id: 'tarifa-a', cliente_id: 'a', precio_base: 500 }, { id: 'tarifa-b', cliente_id: 'b', precio_base: 400 }];
  expect(routesForCustomer(routes, 'b')).toEqual([routes[1]]);
  expect(routesForCustomer(routes, '')).toEqual([]);
});

test("un viaje existente sin precio unitario conserva su importe al editarlo", () => {
  expect(recoverExistingTripPrice({ id: 'pedido-b', tipo_precio: 'viaje', importe: 400, precio_unitario: null })).toBe(400);
  expect(recoverExistingTripPrice({ id: 'pedido-b', tipo_precio: 'viaje', importe: 430, extracostes_importe: 20 }, 10)).toBe(400);
  expect(recoverExistingTripPrice({ id: 'pedido-b', tipo_precio: 'viaje', importe: 430, precio_unitario: 380 })).toBeNull();
  expect(recoverExistingTripPrice({ tipo_precio: 'viaje', importe: 430 })).toBeNull();
});
