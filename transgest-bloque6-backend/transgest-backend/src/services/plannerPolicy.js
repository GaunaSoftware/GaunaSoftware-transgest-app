// Planner and TransGest share operational capabilities. Authentication, module
// permissions and plan entitlements are enforced by each API route.
function plannerPolicy(req,res,next){ return next(); }
module.exports={plannerPolicy};
