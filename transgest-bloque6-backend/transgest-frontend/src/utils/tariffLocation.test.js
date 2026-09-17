import {tariffEndpointScore,bestTariffCandidates} from './tariffLocation';
test('Alboraya matches Valencia province including bilingual tariffs but not another town',()=>{
  expect(tariffEndpointScore('Alboraya','VALENCIA')).toBe(3);
  expect(tariffEndpointScore('Alboraya','VALENCIA/VALÈNCIA')).toBe(3);
  expect(tariffEndpointScore('Alboraya','Gandia')).toBe(0);
  expect(tariffEndpointScore('Alboraya','Alboraya')).toBe(4);
  expect(tariffEndpointScore('Aspe','San Vicente del Raspeig')).toBe(0);
});
test('equally specific tariffs require selection instead of arbitrarily choosing a price',()=>{
  const routes=[{destino:'VALENCIA',precio:14.69},{destino:'VALENCIA/VALÈNCIA',precio:13.45}];
  expect(bestTariffCandidates(routes,r=>tariffEndpointScore('Alboraya',r.destino))).toEqual(routes);
});
