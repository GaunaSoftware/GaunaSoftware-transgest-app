const fs=require('fs'),path=require('path');
const sql=['019_planner_inventory.sql','020_planner_workspace_pricing.sql','021_planner_operational_flow.sql'].map(file=>fs.readFileSync(path.join(__dirname,'../../scripts/migrations',file),'utf8')).join('\n');
let ready;
function ensurePlannerSchema(db=require('./db')){
 if(!ready)ready=(async()=>{for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);})().catch(error=>{ready=null;throw error;});
 return ready;
}
module.exports={ensurePlannerSchema};
