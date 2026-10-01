export function mergePointGeoDraft(draft = {}, geo = {}) {
  return {
    ...draft,
    ciudad: draft.ciudad || geo.ciudad || "",
    pais: draft.pais || geo.pais || "España",
    provincia: draft.provincia || geo.provincia || "",
    lat: draft.lat || geo.lat || "",
    lng: draft.lng || geo.lng || "",
  };
}
