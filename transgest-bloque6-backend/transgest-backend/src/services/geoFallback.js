function foldGeoText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PLACES = [
  ["Madrid", "Madrid", "Espana", 40.4168, -3.7038, ["Comunidad de Madrid"]],
  ["Alcala de Henares", "Madrid", "Espana", 40.4810, -3.3640],
  ["Getafe", "Madrid", "Espana", 40.3083, -3.7319],
  ["Pinto", "Madrid", "Espana", 40.2415, -3.6994],
  ["Alicante", "Alicante", "Espana", 38.3452, -0.4907, ["Alacant"]],
  ["Valencia", "Valencia", "Espana", 39.4699, -0.3763],
  ["Gandia", "Valencia", "Espana", 38.9680, -0.1845],
  ["Castellon", "Castellon", "Espana", 39.9864, -0.0513, ["Castello"]],
  ["Barcelona", "Barcelona", "Espana", 41.3851, 2.1734],
  ["Tarragona", "Tarragona", "Espana", 41.1189, 1.2445],
  ["Lleida", "Lleida", "Espana", 41.6176, 0.6200, ["Lerida"]],
  ["Girona", "Girona", "Espana", 41.9794, 2.8214, ["Gerona"]],
  ["Zaragoza", "Zaragoza", "Espana", 41.6488, -0.8891],
  ["Sevilla", "Sevilla", "Espana", 37.3891, -5.9845],
  ["Jerez de la Frontera", "Cadiz", "Espana", 36.6850, -6.1261, ["Jerez"]],
  ["Jerez de los Caballeros", "Badajoz", "Espana", 38.3206, -6.7726],
  ["Malaga", "Malaga", "Espana", 36.7213, -4.4214],
  ["Cordoba", "Cordoba", "Espana", 37.8882, -4.7794],
  ["Granada", "Granada", "Espana", 37.1773, -3.5986],
  ["Almeria", "Almeria", "Espana", 36.8402, -2.4637],
  ["Murcia", "Murcia", "Espana", 37.9922, -1.1307],
  ["Cartagena", "Murcia", "Espana", 37.6257, -0.9966],
  ["Abanilla", "Murcia", "Espana", 38.2058, -1.0392],
  ["Pamplona", "Navarra", "Espana", 42.8125, -1.6458, ["Iruna"]],
  ["Bilbao", "Bizkaia", "Espana", 43.2630, -2.9350],
  ["Vitoria", "Alava", "Espana", 42.8467, -2.6727, ["Gasteiz"]],
  ["San Sebastian", "Gipuzkoa", "Espana", 43.3183, -1.9812, ["Donostia"]],
  ["Valladolid", "Valladolid", "Espana", 41.6523, -4.7245],
  ["Burgos", "Burgos", "Espana", 42.3439, -3.6969],
  ["Leon", "Leon", "Espana", 42.5987, -5.5671],
  ["Salamanca", "Salamanca", "Espana", 40.9701, -5.6635],
  ["Badajoz", "Badajoz", "Espana", 38.8794, -6.9707],
  ["Caceres", "Caceres", "Espana", 39.4753, -6.3712],
  ["Albacete", "Albacete", "Espana", 38.9943, -1.8585],
  ["Munera", "Albacete", "Espana", 39.0413, -2.4803, ["Minera Santa Marta", "MSM"]],
  ["Toledo", "Toledo", "Espana", 39.8628, -4.0273],
  ["Guadalajara", "Guadalajara", "Espana", 40.6332, -3.1665],
  ["Albalate de Zorita", "Guadalajara", "Espana", 40.3087, -2.8427, ["Albalate de la Zorita"]],
  ["Valderrobres", "Teruel", "Espana", 40.8734, 0.1551, ["Valderrobles", "Vall-de-roures", "Vall de Roures"]],
  ["A Coruna", "A Coruna", "Espana", 43.3623, -8.4115, ["Coruna"]],
  ["Vigo", "Pontevedra", "Espana", 42.2406, -8.7207],
  ["Lisboa", "Lisboa", "Portugal", 38.7223, -9.1393, ["Lisbon"]],
  ["Porto", "Porto", "Portugal", 41.1579, -8.6291, ["Oporto"]],
  ["Paris", "Ile-de-France", "Francia", 48.8566, 2.3522],
  ["Lyon", "Auvergne-Rhone-Alpes", "Francia", 45.7640, 4.8357],
  ["Bordeaux", "Nouvelle-Aquitaine", "Francia", 44.8378, -0.5792, ["Burdeos"]],
  ["Toulouse", "Occitanie", "Francia", 43.6047, 1.4442, ["Tolosa"]],
  ["Marseille", "Provence-Alpes-Cote d Azur", "Francia", 43.2965, 5.3698, ["Marsella"]],
  ["London", "England", "Reino Unido", 51.5074, -0.1278, ["Londres"]],
  ["Dover", "England", "Reino Unido", 51.1279, 1.3134],
  ["Birmingham", "England", "Reino Unido", 52.4862, -1.8904],
  ["Manchester", "England", "Reino Unido", 53.4808, -2.2426],
  ["Brussels", "Brussels", "Belgica", 50.8503, 4.3517, ["Bruselas"]],
  ["Antwerp", "Flanders", "Belgica", 51.2194, 4.4025, ["Amberes"]],
  ["Amsterdam", "North Holland", "Paises Bajos", 52.3676, 4.9041],
  ["Rotterdam", "South Holland", "Paises Bajos", 51.9244, 4.4777],
  ["Berlin", "Berlin", "Alemania", 52.5200, 13.4050, ["Berlin"]],
  ["Hamburg", "Hamburg", "Alemania", 53.5511, 9.9937, ["Hamburgo"]],
  ["Frankfurt", "Hesse", "Alemania", 50.1109, 8.6821, ["Francfort"]],
  ["Munich", "Bavaria", "Alemania", 48.1351, 11.5820, ["Munchen"]],
  ["Milan", "Lombardia", "Italia", 45.4642, 9.1900, ["Milano"]],
  ["Turin", "Piamonte", "Italia", 45.0703, 7.6869, ["Torino"]],
  ["Rome", "Lazio", "Italia", 41.9028, 12.4964, ["Roma"]],
  ["Bologna", "Emilia-Romagna", "Italia", 44.4949, 11.3426, ["Bolonia"]],
  ["Zurich", "Zurich", "Suiza", 47.3769, 8.5417],
  ["Vienna", "Vienna", "Austria", 48.2082, 16.3738, ["Viena"]],
  ["Prague", "Prague", "Chequia", 50.0755, 14.4378, ["Praga"]],
  ["Warsaw", "Masovia", "Polonia", 52.2297, 21.0122, ["Varsovia"]],
];

const INDEX = PLACES.flatMap(([municipio, provincia, pais, lat, lng, aliases = []]) => (
  [municipio, ...aliases].map(alias => ({
    alias: foldGeoText(alias), municipio, provincia, pais, lat, lng,
  }))
)).sort((a, b) => b.alias.length - a.alias.length);

function fallbackPlaceForAddress(value) {
  const text = foldGeoText(value);
  if (!text) return null;
  const place = INDEX.find(item => text === item.alias)
    || INDEX.find(item => item.alias.length >= 4 && text.includes(item.alias));
  return place ? { ...place, label: [place.municipio, place.provincia, place.pais].filter(Boolean).join(", ") } : null;
}

module.exports = { foldGeoText, fallbackPlaceForAddress };
