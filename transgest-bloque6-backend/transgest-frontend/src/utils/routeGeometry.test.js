import { decodeFlexiblePolyline, routeGeometry } from './routeGeometry';

test('decodes HERE published reference without exchanging latitude and longitude', () => {
  expect(decodeFlexiblePolyline('BFoz5xJ67i1B1B7PzIhaxL7Y')).toEqual([
    {lat:50.10228,lng:8.69821},{lat:50.10201,lng:8.69567},
    {lat:50.10063,lng:8.6915},{lat:50.09878,lng:8.68752},
  ]);
});
test('uses actual ORS/OSRM geometry and rejects absent or corrupt routes', () => {
  expect(routeGeometry({type:'LineString',coordinates:[[-3,40],[-2,41]]})).toEqual([{lng:-3,lat:40},{lng:-2,lat:41}]);
  expect(routeGeometry(['BFoz5xJ67i1B1B7PzIhaxL7Y'])).toHaveLength(4);
  for (const input of [null, ['BFoz'], ['?'], {type:'LineString',coordinates:[[null,40]]}]) expect(routeGeometry(input)).toEqual([]);
});
