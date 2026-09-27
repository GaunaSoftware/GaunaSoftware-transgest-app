// Decision aid only: recorded windows and capacities, explicit travel estimates.
// No tachograph compliance or actual arrival is inferred from this schedule.
const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function windowInstant(date,time){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))return null;
 const guess=Date.parse(`${date}T${time}:00Z`),match=[];
 for(const offset of [60,120]){const candidate=guess-offset*60000;if(fmt.format(candidate)===`${date} ${time}`)match.push(candidate);}
 return match.length===1?match[0]:null; // DST gap/overlap requires an explicit unambiguous agreement.
}
function windowOf(stop){
 const range=String(stop.window||'').match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
 const start=stop.window_start||range?.[1]?.padStart(5,'0'),end=stop.window_end||range?.[2]?.padStart(5,'0');
 const a=windowInstant(stop.date,start),b=windowInstant(stop.date,end);
 return a!=null&&b!=null&&b>=a?{start:a,end:b}:null;
}
function validateRules(raw={}){
 const local=raw.start_day||raw.start_time;
 const start=local?windowInstant(raw.start_day,raw.start_time):Date.parse(raw.start_at);
 if(start==null||!Number.isFinite(start)||!local&&!/(Z|[+-]\d\d:\d\d)$/.test(raw.start_at||''))fail('Indica una salida válida. En el cambio de hora no se admiten horas ambiguas o inexistentes.');
 const config={start_at:new Date(start).toISOString(),capacity_kg:num(raw.capacity_kg),service_min:num(raw.service_min),drive_limit_min:num(raw.drive_limit_min),break_min:num(raw.break_min),already_driven_min:num(raw.already_driven_min)};
 for(const key of ['capacity_kg','service_min','drive_limit_min','break_min','already_driven_min'])if(config[key]!=null&&(config[key]<0||config[key]>1e7))fail('Restricción fuera de rango: '+key);
 if(config.drive_limit_min!=null&&(config.drive_limit_min<1||config.drive_limit_min>1440||!(config.break_min>=1&&config.break_min<=1440)))fail('Indica intervalo de conducción y pausa entre 1 y 1.440 minutos.');
 if(config.already_driven_min!=null&&config.drive_limit_min==null)fail('Indica el intervalo de conducción para aplicar el tiempo previo.');
 return config;
}
function proposeSequence(stops,raw){
 const rules=validateRules(raw),pending=[...stops],result=[],loaded=new Set();let weight=0;
 while(pending.length){
   const eligible=pending.filter(s=>s.type!=='descarga'||s.shipment_id&&loaded.has(s.shipment_id));
   if(!eligible.length)fail('No se puede ordenar: identifica la carga anterior de cada envío.');
   const fits=eligible.filter(s=>s.type!=='carga'||rules.capacity_kg==null||num(s.weight_kg)==null||weight+Number(s.weight_kg)<=rules.capacity_kg);
   const options=fits.length?fits:eligible,last=result.at(-1);
   const distance=s=>last&&num(last.lat)!=null&&num(s.lat)!=null&&num(last.lng)!=null&&num(s.lng)!=null?(Number(last.lat)-Number(s.lat))**2+(Number(last.lng)-Number(s.lng))**2:0;
   options.sort((a,b)=>(windowOf(a)?.end??Infinity)-(windowOf(b)?.end??Infinity)||distance(a)-distance(b));
   const next=options[0];result.push(next);pending.splice(pending.indexOf(next),1);
   if(next.shipment_id){if(next.type==='carga'){loaded.add(next.shipment_id);weight+=num(next.weight_kg)||0;}else{loaded.delete(next.shipment_id);weight-=num(next.weight_kg)||0;}}
 }
 return result;
}
function evaluateConstraints(stops,route,raw){
 const rules=validateRules(raw),issues=[],schedule=[],loaded=new Map();let clock=Date.parse(rules.start_at),driven=rules.already_driven_min??null,weight=0;
 const warning=(code,text,stop=null,level='pendiente')=>issues.push({code,text,stop_id:stop?.id||null,level});
 if(!route.truck_aware)warning('TRUCK_ROAD','El proveedor no comprueba las restricciones de circulación del camión.');
 if(!raw.truck_profile_confirmed)warning('TRUCK_PROFILE','Revisa las medidas y peso bruto del conjunto; el perfil no está confirmado.');
 if(rules.capacity_kg==null)warning('CAPACITY','No se ha indicado capacidad útil en kg.');
 if(rules.drive_limit_min==null||driven==null)warning('BREAKS','Faltan las pausas de planificación o la conducción acumulada; no se valida la jornada.');
 const legs=route.legs?.length===stops.length-1?route.legs:[];
 for(const [i,stop] of stops.entries()){
   const travel=i===0?0:num(legs[i-1]?.duration_min);let pauses=0;
   if(travel==null||travel<0||travel>10080){warning('TRAVEL','Falta duración de carretera de este tramo.',stop);clock=null;}
   else if(clock!=null){
     if(rules.drive_limit_min&&driven!=null){let remaining=travel;
       while(remaining>0){if(driven>=rules.drive_limit_min){clock+=rules.break_min*60000;pauses+=rules.break_min;driven=0;}
         const take=Math.min(remaining,rules.drive_limit_min-driven);clock+=take*60000;driven+=take;remaining-=take;}
     }else clock+=travel*60000;
   }
   const arrival=clock,window=windowOf(stop);
   if(!window)warning('WINDOW','Sin ventana completa y unívoca; revisa fecha y horario pactados.',stop);
   if(window&&clock!=null){if(clock>window.end)warning('LATE','Llegada propuesta posterior a la ventana pactada.',stop,'conflicto');clock=Math.max(clock,window.start);}
   if(stop.shipment_id){const q=num(stop.weight_kg);
     if(q==null||q<0)warning('GOODS','Falta peso válido del envío.',stop);
     if(stop.type==='carga'){if(loaded.has(stop.shipment_id))warning('DUPLICATE','Envío cargado dos veces.',stop,'conflicto');else{loaded.set(stop.shipment_id,q);weight+=q||0;}}
     else if(stop.type==='descarga'){if(!loaded.has(stop.shipment_id))warning('PRECEDENCE','Descarga anterior a su carga.',stop,'conflicto');else{weight-=loaded.get(stop.shipment_id)||0;loaded.delete(stop.shipment_id);}}
   }else warning('SHIPMENT','Falta identificar el envío.',stop);
   if(rules.capacity_kg!=null&&weight>rules.capacity_kg)warning('OVERWEIGHT','El peso simultáneo supera la capacidad útil.',stop,'conflicto');
   const service=num(stop.service_min)??rules.service_min,start=clock;
   if(service==null||service<0){warning('HANDLING','Falta duración prevista de operación.',stop);clock=null;}else if(clock!=null)clock+=service*60000;
   schedule.push({stop_id:stop.id,arrival_at:arrival==null?null:new Date(arrival).toISOString(),start_at:start==null?null:new Date(start).toISOString(),end_at:clock==null?null:new Date(clock).toISOString(),travel_min:travel,pause_min:pauses,load_kg:[...loaded.values()].some(v=>v==null)?null:weight});
 }
 return {version:'route.constraints.v1',estado:issues.some(i=>i.level==='conflicto')?'conflicto':issues.length?'parcial':'evaluado',reglas:rules,incidencias:issues,paradas:schedule,
   definicion:'Propuesta por ventanas, precedencia de envío y capacidad en kg, con tiempos de carretera del proveedor. Pausas configuradas de planificación; no certifica cumplimiento de tacógrafo ni garantiza tráfico real.',requiere_aprobacion:true};
}
function proposalSnapshot(review,ordered){
 if(review==null)return null;
 if(review.version!=='route.constraints.v1'||!Array.isArray(review.paradas)||JSON.stringify(review.paradas.map(s=>s.stop_id))!==JSON.stringify(ordered)||JSON.stringify(review).length>100000)fail('La propuesta de restricciones no corresponde a esta secuencia. Calcula de nuevo.');
 return {...review,origen:'propuesta_guardada_por_trafico',verificacion:'estimacion_no_certificada'};
}
module.exports={windowInstant,windowOf,validateRules,proposeSequence,evaluateConstraints,proposalSnapshot};
