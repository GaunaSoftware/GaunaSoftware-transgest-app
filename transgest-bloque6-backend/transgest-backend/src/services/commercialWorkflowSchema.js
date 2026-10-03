const fs=require('node:fs');
const path=require('node:path');
const pending=new WeakMap();
function ensureCommercialWorkflowSchema(db){
 if(!pending.has(db))pending.set(db,(async()=>{
  for(const name of ['20261002_commercial_route_points.sql','20261002_commercial_order_terms.sql','20261002_order_packaging.sql'])
   await db.query(fs.readFileSync(path.join(__dirname,'../../scripts/migrations',name),'utf8'));
 })().catch(error=>{pending.delete(db);throw error;}));
 return pending.get(db);
}
module.exports={ensureCommercialWorkflowSchema};
