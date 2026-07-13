const assert = require("assert");
const {
  isCountryOnlyQuery,
  parsePlaceRequest,
  selectBestPlaceCandidate,
} = require("../src/services/geoPlaceMatch");

const guadalajara = {
  municipio: "Albalate de Zorita",
  provincia: "Guadalajara",
  pais: "España",
  country_code: "es",
  lat: 40.3087,
  lng: -2.8427,
  label: "Albalate de Zorita, Guadalajara, España",
  result_type: "village",
  quality: 0.55,
};
const wrongProvince = {
  ...guadalajara,
  municipio: "Albalate de la Zorita",
  provincia: "Cádiz",
  lat: 36.5,
  lng: -6.2,
  label: "Albalate de la Zorita, Cádiz, España",
  quality: 0.9,
};

const requested = parsePlaceRequest("Albalate de la Zorita (Guadalajara)", "España", "");
assert.strictEqual(requested.region, "Guadalajara");
assert.strictEqual(selectBestPlaceCandidate(requested, [wrongProvince, guadalajara]), guadalajara);

const abanilla = {
  municipio: "Abanilla",
  provincia: "Región de Murcia",
  pais: "España",
  country_code: "es",
  lat: 38.2058,
  lng: -1.0392,
  label: "Abanilla, Región de Murcia, España",
  result_type: "town",
};
assert.strictEqual(selectBestPlaceCandidate(parsePlaceRequest("Abanilla", "España", ""), [abanilla]), abanilla);
assert.strictEqual(selectBestPlaceCandidate(parsePlaceRequest("Cementos Capa", "España", ""), [abanilla]), null);

const valderrobres = {
  municipio: "Valderrobres",
  provincia: "Teruel",
  pais: "Espana",
  country_code: "es",
  lat: 40.8734,
  lng: 0.1551,
  label: "Valderrobres, Teruel, Espana",
  aliases: ["Vall-de-roures"],
  result_type: "town",
};
assert.strictEqual(
  selectBestPlaceCandidate(parsePlaceRequest("Valderrobles (Teruel)", "Espana", ""), [valderrobres]),
  valderrobres
);
assert.strictEqual(isCountryOnlyQuery("Espana", "Espana"), true);
assert.strictEqual(isCountryOnlyQuery("Teruel", "Espana"), false);

console.log("Geocoding regression checks OK");
