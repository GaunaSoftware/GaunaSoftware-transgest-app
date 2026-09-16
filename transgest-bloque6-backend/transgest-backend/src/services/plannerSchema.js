const fs=require('fs'),path=require('path');
const sql=fs.readFileSync(path.join(__dirname,'../../scripts/migrations/019_planner_inventory.sql'),'utf8');
let ready;
function ensurePlannerSchema(db=require('./db')){
 if(!ready)ready=(async()=>{for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);})().catch(error=>{ready=null;throw error;});
 return ready;
}
module.exports={ensurePlannerSchema};
