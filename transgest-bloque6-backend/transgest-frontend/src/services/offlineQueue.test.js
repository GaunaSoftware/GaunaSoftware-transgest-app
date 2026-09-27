import { enqueueOfflineItem, readOfflineQueue, writeOfflineQueue, getOfflineOwner, readyOfflineItems, markOfflineAttempt } from './offlineQueue';
const user=(id,company='a')=>localStorage.setItem('tms_user',JSON.stringify({id,empresa_id:company}));
beforeEach(()=>localStorage.clear());
test('pending driver actions remain isolated by company and user after logout/login',()=>{
 user('one');const owner=getOfflineOwner();enqueueOfflineItem({tipo:'pedido_estado',pedido_id:'order-a',estado:'en_curso'});
 user('two');expect(readOfflineQueue()).toEqual([]);enqueueOfflineItem({tipo:'pedido_estado',pedido_id:'order-b'});
 writeOfflineQueue([],owner);expect(readOfflineQueue()[0].pedido_id).toBe('order-b');
 user('two','b');expect(readOfflineQueue()).toEqual([]);
});
test('unowned legacy queue is retained but never replayed under a new login',()=>{
 localStorage.setItem('tms_offline_queue',JSON.stringify([{tipo:'pedido_estado',pedido_id:'legacy'}]));user('one');
 expect(readyOfflineItems()).toEqual([]);expect(localStorage.getItem('tms_offline_queue')).toContain('legacy');
});
test('a failed request finishing after account switching stays with its original owner',()=>{
 user('one');const owner=getOfflineOwner();user('two');
 enqueueOfflineItem({tipo:'pedido_estado',pedido_id:'original-order'},owner);
 expect(readOfflineQueue()).toEqual([]);
 expect(readOfflineQueue(owner)[0].pedido_id).toBe('original-order');
});
test('deduplicated retry is retained and delayed; logout cannot enqueue an anonymous write',()=>{
 user('one');enqueueOfflineItem({tipo:'pedido_estado',dedupe_key:'state:1',estado:'cargando'});enqueueOfflineItem({tipo:'pedido_estado',dedupe_key:'state:1',estado:'en_curso'});
 expect(readOfflineQueue()).toHaveLength(1);writeOfflineQueue(readOfflineQueue().map(x=>markOfflineAttempt(x,'offline')));expect(readyOfflineItems()).toEqual([]);
 localStorage.removeItem('tms_user');expect(enqueueOfflineItem({tipo:'pedido_estado'})).toEqual([]);
});

test('a stop confirmation keeps the same operation UUID after persistence and retry',()=>{
 user('one');const patch={parada_id:'carga-1',carga_ok:true,client_operation_uuid:'11111111-1111-4111-8111-111111111111'};
 enqueueOfflineItem({tipo:'pedido_chofer_pasos',pedido_id:'order-a',patch});
 writeOfflineQueue(readOfflineQueue().map(item=>markOfflineAttempt(item,'Sin cobertura')));
 expect(readOfflineQueue()[0].patch).toEqual(patch);
 user('two');expect(readOfflineQueue()).toEqual([]);
});
