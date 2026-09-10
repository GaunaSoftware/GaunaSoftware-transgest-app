import { loadPlannerClients } from './catalogs';
test('loads every page and deduplicates recipient ids', async()=>{
  const fetchPage=jest.fn(async page=>({data:page===1?[{id:'a'},{id:'b'}]:[{id:'b'},{id:'c'}],pagination:{hasNext:page===1}}));
  expect((await loadPlannerClients(fetchPage)).map(c=>c.id)).toEqual(['a','b','c']);
  expect(fetchPage.mock.calls).toEqual([[1,250],[2,250]]);
});
test('supports a legacy array and stops when unmounted',async()=>{
  expect(await loadPlannerClients(async()=>[{id:'a'}])).toEqual([{id:'a'}]);
  const fetchPage=jest.fn();expect(await loadPlannerClients(fetchPage,()=>false)).toEqual([]);expect(fetchPage).not.toHaveBeenCalled();
});
