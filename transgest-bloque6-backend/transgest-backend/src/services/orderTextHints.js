const {parseLocaleNumber}=require('../utils/number');

// Explicit prose cues supplement labelled orders without treating dates as places.
function orderTextHints(text=''){
 const clean=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\r/g,'');
 const date='(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})';
 const match=pattern=>clean.match(pattern)?.[1]?.trim()||'';
 const origin=match(/\b(?:cargar|recoger)\b[^\n]{0,60}?\b(?:en|desde)\s+([\s\S]{2,160}?)(?=\s*,?\s*(?:para\s+)?(?:entregar|descargar)\b|[.;]|\n\s*\n|$)/i);
 const destination=match(/\b(?:entregar|descargar)\s+(?:en|a)\s+([^\n.;]{2,120})/i);
 const loadDate=match(new RegExp(`\\b(?:cargar|recoger|carga|recogida)\\s*:?\\s*${date}`,'i'));
 const unloadDate=match(new RegExp(`\\b(?:entrega|descarga|entregar|descargar)[^\\n]{0,60}?${date}`,'i'));
 const kg=match(/\b(\d{1,3}(?:[. ]\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?)\s*(?:kg|kilos)\b/i);
 const grouped=/^\d{1,3}(?:[. ]\d{3})+(?:,\d+)?$/.test(kg);
 return {origin:origin.replace(/\s+/g,' ').replace(/,\s*$/,''),destination,loadDate,unloadDate,weightKg:kg?parseLocaleNumber(grouped?kg.replace(/[. ]/g,''):kg):null};
}
module.exports={orderTextHints};
