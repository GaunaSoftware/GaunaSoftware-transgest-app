import { getEmpresaPlanLocal, planHasFeature } from "./planFeatures";

const tokenFor = (payload) => `header.${btoa(JSON.stringify(payload))}.signature`;

afterEach(() => localStorage.clear());

test("uses the refreshed company plan when a login token has the previous plan", () => {
  localStorage.setItem("tms_token", tokenFor({ sub: "user-1", empresa_id: "company-1", plan: "lite" }));
  localStorage.setItem("tms_user", JSON.stringify({ id: "user-1", empresa_id: "company-1", plan: "enterprise" }));
  expect(getEmpresaPlanLocal()).toBe("enterprise");
});

test("does not use a cached plan from another company", () => {
  localStorage.setItem("tms_token", tokenFor({ sub: "user-1", empresa_id: "company-1", plan: "lite" }));
  localStorage.setItem("tms_user", JSON.stringify({ id: "user-2", empresa_id: "company-2", plan: "enterprise" }));
  expect(getEmpresaPlanLocal()).toBe("lite");
});

test("Go keeps operational import but excludes advanced modules", () => {
  expect(planHasFeature("go", "importacion")).toBe(true);
  for (const feature of ["app_chofer", "ai", "kpis_avanzados", "here_routing", "optimizacion_rutas", "taller", "contabilidad"]) {
    expect(planHasFeature("go", feature)).toBe(false);
  }
});
