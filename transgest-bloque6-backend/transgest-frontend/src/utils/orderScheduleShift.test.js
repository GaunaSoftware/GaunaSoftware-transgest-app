import { addIsoDays, buildOrderScheduleShift, orderScheduleMatches } from "./orderScheduleShift";

test("retrasar un día cambia la fecha de calendario en España", () => {
  expect(addIsoDays("2026-09-29", 1)).toBe("2026-09-30");
  expect(addIsoDays("2026-03-28", 2)).toBe("2026-03-30");
  expect(addIsoDays("2026-10-24", 2)).toBe("2026-10-26");
  expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
});

test("dos pedidos seleccionados conservan sus intervalos y desplazan todas sus paradas", () => {
  const orders = [
    { fecha_carga: "2026-09-29", fecha_descarga: "2026-09-30", puntos_carga: [{ fecha: "2026-09-29" }], puntos_descarga: [{ fecha: "2026-09-30" }] },
    { fecha_carga: "2026-09-30T00:00:00.000Z", fecha_entrega: "2026-10-02T00:00:00.000Z", puntos_carga: JSON.stringify([{ fecha: "2026-09-30" }, { fecha: "2026-10-01" }]), puntos_descarga: [{ fecha: "2026-10-02" }] },
  ];
  const shifted = orders.map(order => buildOrderScheduleShift(order, 1));
  expect(shifted.map(order => order.fecha_carga)).toEqual(["2026-09-30", "2026-10-01"]);
  expect(shifted[0].fecha_descarga).toBe("2026-10-01");
  expect(shifted[1].fecha_entrega).toBe("2026-10-03");
  expect(shifted[1].puntos_carga.map(stop => stop.fecha)).toEqual(["2026-10-01", "2026-10-02"]);
  expect(orders[1].puntos_descarga[0].fecha).toBe("2026-10-02");
});

test("no declara éxito si la respuesta conserva las fechas antiguas", () => {
  const expected = buildOrderScheduleShift({ fecha_carga: "2026-09-29", fecha_descarga: "2026-09-30" }, 1);
  expect(orderScheduleMatches({ fecha_carga: "2026-09-29", fecha_descarga: "2026-09-30" }, expected)).toBe(false);
  expect(orderScheduleMatches({ fecha_carga: "2026-09-30T00:00:00.000Z", fecha_descarga: "2026-10-01" }, expected)).toBe(true);
  expect(() => buildOrderScheduleShift({ fecha_carga: null }, 1)).toThrow(/fecha de carga/);
});
