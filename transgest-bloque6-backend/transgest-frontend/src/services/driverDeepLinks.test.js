import {driverOrderFromLink} from './driverDeepLinks';
test('driver deep links only navigate to an exact order identifier, without tokens or actions',()=>{
 const id='1407a1ff-6f3b-48d5-bca0-1b613c3a8765';
 expect(driverOrderFromLink(`transgest://chofer/pedidos/${id}`)).toBe(id);
 for(const value of [`https://evil.invalid/${id}`,`transgest://chofer/pedidos/${id}?token=secret`,`transgest://chofer/pedidos/${id}/firma`,`transgest://admin/pedidos/${id}`,`transgest://chofer/pedidos/../../${id}`,null])expect(driverOrderFromLink(value)).toBeNull();
});
