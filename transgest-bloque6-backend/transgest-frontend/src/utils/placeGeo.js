export function normalizePlaceKey(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const KNOWN_PLACES = {
  madrid: { municipio:"Madrid", provincia:"Madrid", pais:"Espana", lat:40.4168, lng:-3.7038 },
  madrid_comunidad: { municipio:"Madrid", provincia:"Madrid", pais:"Espana", lat:40.4168, lng:-3.7038 },
  comunidad_de_madrid: { municipio:"Madrid", provincia:"Madrid", pais:"Espana", lat:40.4168, lng:-3.7038 },
  barcelona: { municipio:"Barcelona", provincia:"Barcelona", pais:"Espana", lat:41.3874, lng:2.1686 },
  valencia: { municipio:"Valencia", provincia:"Valencia", pais:"Espana", lat:39.4699, lng:-0.3763 },
  alicante: { municipio:"Alicante", provincia:"Alicante", pais:"Espana", lat:38.3452, lng:-0.4810 },
  malaga: { municipio:"Malaga", provincia:"Malaga", pais:"Espana", lat:36.7213, lng:-4.4214 },
  sevilla: { municipio:"Sevilla", provincia:"Sevilla", pais:"Espana", lat:37.3891, lng:-5.9845 },
  zaragoza: { municipio:"Zaragoza", provincia:"Zaragoza", pais:"Espana", lat:41.6488, lng:-0.8891 },
  murcia: { municipio:"Murcia", provincia:"Murcia", pais:"Espana", lat:37.9922, lng:-1.1307 },
  bilbao: { municipio:"Bilbao", provincia:"Bizkaia", pais:"Espana", lat:43.2630, lng:-2.9350 },
  valladolid: { municipio:"Valladolid", provincia:"Valladolid", pais:"Espana", lat:41.6523, lng:-4.7245 },
  burgos: { municipio:"Burgos", provincia:"Burgos", pais:"Espana", lat:42.3439, lng:-3.6969 },
  torrelavega: { municipio:"Torrelavega", provincia:"Cantabria", pais:"Espana", lat:43.3494, lng:-4.0479 },
  gandia: { municipio:"Gandia", provincia:"Valencia", pais:"Espana", lat:38.9680, lng:-0.1845 },
  gandia_valencia: { municipio:"Gandia", provincia:"Valencia", pais:"Espana", lat:38.9680, lng:-0.1845 },
  minera_santa_marta: { municipio:"Munera", provincia:"Albacete", pais:"Espana", lat:39.0413, lng:-2.4803 },
  minera_santa_marta_msm: { municipio:"Munera", provincia:"Albacete", pais:"Espana", lat:39.0413, lng:-2.4803 },
  msm: { municipio:"Munera", provincia:"Albacete", pais:"Espana", lat:39.0413, lng:-2.4803 },
  munera: { municipio:"Munera", provincia:"Albacete", pais:"Espana", lat:39.0413, lng:-2.4803 },
  villarrobledo: { municipio:"Villarrobledo", provincia:"Albacete", pais:"Espana", lat:39.2699, lng:-2.6012 },
  almansa: { municipio:"Almansa", provincia:"Albacete", pais:"Espana", lat:38.8692, lng:-1.0979 },
  ontinyent: { municipio:"Ontinyent", provincia:"Valencia", pais:"Espana", lat:38.8210, lng:-0.6060 },
  xativa: { municipio:"Xativa", provincia:"Valencia", pais:"Espana", lat:38.9897, lng:-0.5188 },
  alzira: { municipio:"Alzira", provincia:"Valencia", pais:"Espana", lat:39.1518, lng:-0.4398 },
  sagunto: { municipio:"Sagunto", provincia:"Valencia", pais:"Espana", lat:39.6792, lng:-0.2784 },
  ribarroja: { municipio:"Riba-roja de Turia", provincia:"Valencia", pais:"Espana", lat:39.5450, lng:-0.5708 },
  riba_roja: { municipio:"Riba-roja de Turia", provincia:"Valencia", pais:"Espana", lat:39.5450, lng:-0.5708 },
  torrent: { municipio:"Torrent", provincia:"Valencia", pais:"Espana", lat:39.4371, lng:-0.4655 },
  abanilla: { municipio:"Abanilla", provincia:"Murcia", pais:"Espana", lat:38.2056, lng:-1.0414 },
  lorqui: { municipio:"Lorqui", provincia:"Murcia", pais:"Espana", lat:38.0819, lng:-1.2510 },
  alcala_de_henares: { municipio:"Alcala de Henares", provincia:"Madrid", pais:"Espana", lat:40.4819, lng:-3.3635 },
  arganda_del_rey: { municipio:"Arganda del Rey", provincia:"Madrid", pais:"Espana", lat:40.3069, lng:-3.4477 },
  lucena: { municipio:"Lucena", provincia:"Cordoba", pais:"Espana", lat:37.4088, lng:-4.4852 },
  torrelavit: { municipio:"Torrelavit", provincia:"Barcelona", pais:"Espana", lat:41.4460, lng:1.7290 },
};

export function inferPlaceGeo(...values) {
  const keys = values
    .filter(Boolean)
    .flatMap(value => {
      if (typeof value === "object") {
        return [value.nombre, value.name, value.direccion, value.address, value.municipio, value.city, value.ciudad]
          .filter(Boolean)
          .map(normalizePlaceKey);
      }
      const key = normalizePlaceKey(value);
      const compact = key.replace(/(^|_)s_l(_|$)/g, "_").replace(/(^|_)s_a(_|$)/g, "_");
      return [key, compact];
    })
    .filter(Boolean);

  for (const key of keys) {
    if (KNOWN_PLACES[key]) return KNOWN_PLACES[key];
    const match = Object.keys(KNOWN_PLACES).find(k => key.length >= 4 && (key.includes(k) || k.includes(key)));
    if (match) return KNOWN_PLACES[match];
  }
  return null;
}

export function coordsForKnownPlace(...values) {
  const geo = inferPlaceGeo(...values);
  return geo ? { lat: geo.lat, lng: geo.lng } : null;
}
