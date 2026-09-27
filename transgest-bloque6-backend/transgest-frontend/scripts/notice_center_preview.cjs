// Local-only synthetic API with the real compiled UI. Never calls production.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../build');
const user={id:'qa-user',empresa_id:'qa-company',rol:'gerente',nombre:'DEMO SINTÉTICA',plan:'enterprise',productos:['transgest'],activo:true};
const categories=[['facturas','Facturas y cobros'],['vehiculos','Vehículos y remolques'],['choferes','Conductores'],['plataformas','Plataformas']].map(([key,label])=>({key,label,enabled:true,days:30}));
const invoice={id:'invoice-qa',numero:'QA-2026-0072',cliente_nombre:'CLIENTE SINTÉTICO',fecha:'2026-09-01',fecha_vencimiento:'2026-09-15',estado:'emitida',base_imponible:1000,total:1210,iva_porcentaje:21,lineas:[{descripcion:'Servicio de prueba',cantidad:1,precio_unitario:1000,importe:1000}]};
const items=[{id:'facturas:qa',category:'facturas',title:'Factura QA-2026-0072',date:'2026-09-15',days:-12,severity:'vencido',entity:'CLIENTE SINTÉTICO',amount:1210,view:'facturacion',focusKey:'tms_facturacion_focus',focus:{factura_id:invoice.id,open:true},description:'Total con impuestos; pendiente de comprobar el cobro.'},
 {id:'vehiculos:qa',category:'vehiculos',title:'ITV · QA-REMOLQUE',entity:'QA-REMOLQUE',date:'2026-09-20',days:-7,severity:'vencido',view:'vehiculos',focusKey:'tms_vehiculos_focus',focus:{vehiculo_id:'truck-qa',section:'documentacion',open:true}},
 {id:'plataformas:qa',category:'plataformas',title:'Acceso plataforma · Certificado de seguro',entity:'QA-REMOLQUE',date:'2026-10-02',days:5,severity:'proximo',view:'vehiculos',focusKey:'tms_vehiculos_focus',focus:{vehiculo_id:'truck-qa',open:true}}];
let unread=92;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/v1/')){
  const p=url.pathname.slice(7);let data=[];
  if(p==='/auth/me')data=user;
  else if(p==='/notificaciones/centro')data={items:items.filter(i=>categories.find(c=>c.key===i.category).enabled),categories,date:'2026-09-27',errors:[],coverage:'completo'};
  else if(p==='/notificaciones/configuracion'){let raw='';for await(const chunk of req)raw+=chunk;const next=JSON.parse(raw);for(const c of next)Object.assign(categories.find(r=>r.key===c.key),c);data=categories;}
  else if(p==='/notificaciones/operativas/leer-todas'){data={ok:true,actualizadas:unread};unread=0;}
  else if(p==='/notificaciones/operativas/colaboradores')data={items:unread?[{key:'qa',kind:'albaran_pendiente',severity:'alta',title:'POD pendiente · QA-001',detail:'Aviso de prueba',pedido_numero:'QA-001',pedido_id:'order-qa'}]:[],resumen:{total:unread,alta:unread}};
  else if(p.includes('notificaciones'))data={data:[],no_leidas:0};
  else if(p==='/ia/intelligence/estado')data={configured:true,available:true,remaining:1000,tools:['buscar_pedidos','vencimientos_empresa','analisis_rentabilidad','disponibilidad_flota']};
  else if(p==='/ia/intelligence/chat')data={answer:'## Resumen de prueba\nHay una factura sintética para revisar.\n\n| Factura | Importe | Cobertura |\n| --- | --- | --- |\n| QA-2026-0072 | 1.210,00 € | Estimado |\n\n## Próximos pasos\n- Abrir la factura y comprobar el cobro antes de reclamar.',sources:[{name:'vencimientos_empresa',filters:{categoria:'facturas'},total:1,coverage:'completo'}],references:items.slice(0,1).map(i=>({...i,label:i.title})),checked_at:new Date().toISOString()};
  else if(p==='/facturas')data=[invoice];
  else if(p==='/facturas/invoice-qa')data=invoice;
  else if(p==='/vehiculos')data=[{id:'truck-qa',matricula:'QA-REMOLQUE',tipo:'remolque',estado:'disponible'}];
  else if(p.includes('empresa')||p.includes('config'))data={id:user.empresa_id,nombre:'EMPRESA SINTÉTICA · QA',plan:'enterprise',cfg_alertas:[],estado:'activo'};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
 }
 let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');
 const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'}[ext]||'text/html'));
 if(ext==='.html'){
  const setup=`<script>localStorage.setItem('transgest_api_url',location.origin);localStorage.setItem('tms_token','synthetic-only');localStorage.setItem('tms_user',${JSON.stringify(JSON.stringify(user))});</script>`;
  res.end(fs.readFileSync(file,'utf8').replace('<head>','<head>'+setup));
 }else fs.createReadStream(file).pipe(res);
});
server.listen(0,'127.0.0.1',()=>console.log('SYNTHETIC ONLY http://127.0.0.1:'+server.address().port));
