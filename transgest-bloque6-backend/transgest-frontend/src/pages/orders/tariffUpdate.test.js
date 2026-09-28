import { tariffChanges, tariffDraftValues } from "./tariffUpdate";

const ruta = { tarifa_tipo: "viaje", precio_base: 480, minimo_facturable: 0, recargo_combustible_pct: 0 };

test("pregunta por cambio de tipo aunque el viaje esté a cero", () => {
  expect(tariffChanges({ ...ruta, precio_base: 0 }, { tipo_precio: "tonelada", precio_unitario: 0, minimo_unidades: 0 }).map(c => c.campo)).toEqual(["Tipo"]);
});

test("distingue el precio unitario de la cantidad y del importe final", () => {
  expect(tariffChanges(ruta, { tipo_precio: "viaje", precio_unitario: 500 }).map(c => c.campo)).toEqual(["Precio base (€)"]);
  const toneladas = { tarifa_tipo: "tonelada", precio_base: 20, minimo_unidades: 0, recargo_combustible_pct: 0 };
  expect(tariffChanges(toneladas, { tipo_precio: "tonelada", precio_unitario: 20, cantidad: 0, minimo_unidades: 0 })).toEqual([]);
  expect(tariffChanges(toneladas, { tipo_precio: "tonelada", precio_unitario: 20, cantidad: 24, minimo_unidades: 0 })).toEqual([]);
});

test("el precio base no incorpora dos veces el recargo de combustible", () => {
  const fuelRoute = { ...ruta, precio_base: 100, recargo_combustible_pct: 5 };
  const draft = { tipo_precio: "viaje", precio_unitario: 105, precio_base_sin_combustible: 100, recargo_combustible_pct: 5 };
  expect(tariffChanges(fuelRoute, draft)).toEqual([]);
  expect(tariffDraftValues({ ...draft, precio_unitario: 110 }).precioBase).toBe(104.7619);
  expect(tariffChanges(fuelRoute, { ...draft, precio_unitario: 110 }).map(c => c.campo)).toEqual(["Precio base (€)"]);
});

test("detecta cero explícito, recargo y mínimo, sin inventar diferencias", () => {
  expect(tariffChanges(ruta, { tipo_precio: "viaje", precio_unitario: 0 }).map(c => c.campo)).toEqual(["Precio base (€)"]);
  expect(tariffChanges(ruta, { tipo_precio: "viaje", precio_unitario: 480, recargo_combustible_pct: 0, importe_minimo: 0 })).toEqual([]);
  expect(tariffChanges(ruta, { tipo_precio: "viaje", precio_unitario: 480, recargo_combustible_pct: 5, importe_minimo: 100 }).map(c => c.campo)).toEqual(["Precio base (€)", "Recargo gasoil (%)", "Mínimo"]);
});
