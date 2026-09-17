import { provinciaDeLugar } from './placeGeo';
export const normalizeTariffPlace = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function tariffEndpointScore(actual, expected, province='') {
  const a=normalizeTariffPlace(actual), e=normalizeTariffPlace(expected);
  if(!e)return 1;
  const names=String(expected).split('/').map(normalizeTariffPlace);
  if(names.includes(a) && a)return 4;
  const p=normalizeTariffPlace(province || provinciaDeLugar(actual));
  if(p && names.some(n=>n===p || n===`provincia ${p}` || n===`${p} provincia`))return 3;
  // A municipality-specific tariff cannot cover another municipality just because
  // both belong to the same province (Alboraya is not Gandia).
  return 0;
}
export function bestTariffCandidates(candidates, score) {
  const ranked=candidates.map(r=>({r,score:score(r)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  return ranked.filter(x=>x.score===ranked[0]?.score).map(x=>x.r);
}
