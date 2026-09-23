const db = require('./db');
const { financialPedidosCte, reportRange, day, money, ratio, metric, reportMetadata } = require('./financialKpis');
const { orderTotals } = require('./financialAnalytics');
const sum = (rows,key) => money(rows.reduce((n,r)=>n+Number(r[key] || 0),0));
function buildRouteSheet({range,orders,repostajes,noches,expenses,repairs,emptyKm=[],config={},fuel={},payroll=null}) {
  const manualEmpty=emptyKm.filter(r=>!String(r.notas || '').startsWith('app_chofer:pedido:'));
  const t=orderTotals(orders), kmCargado=t.kmTotal, kmVacio=t.kmVacio+sum(manualEmpty,'km_vacio'), kmTotal=kmCargado+kmVacio, ingresos=t.ingresos;
  const fuelPrice=date=>{
    const p=(fuel.periodos || []).find(p=>day(date)>=p.desde&&day(date)<=p.hasta);
    const price=fuel.tipo==='fijo'?fuel.precio_fijo:p?.precio;
    return Number(price)>0?Number(price):null;
  };
  const combustible=expenses.filter(g=>g.tipo==='gasoil'&&g.estado==='registrado'), diets=expenses.filter(g=>g.tipo==='dieta'&&g.estado==='registrado');
  const amounts=repostajes.map(r=>r.importe != null?Number(r.importe):Number(r.litros)>0&&(Number(r.precio_litro)>0||fuelPrice(r.fecha)!=null)?Number(r.litros)*Number(r.precio_litro || fuelPrice(r.fecha)):null);
  const fuelCoverage = repostajes.length + combustible.length > 0 || (orders.length === 0 && kmTotal === 0);
  const costeGasoil=!fuelCoverage || amounts.some(v=>v==null) || expenses.some(g=>g.tipo==='gasoil'&&g.estado==='pendiente_base')
    ? null : money(amounts.reduce((n,v)=>n+v,0)+sum(combustible,'importe'));
  const costeNoches=money(sum(noches,'importe')+sum(diets,'importe'));
  const costeTaller=sum(repairs,'coste_total');
  const singleMonth=range.desde.slice(0,7)===range.hasta.slice(0,7);
  const monthDays=new Date(Date.UTC(Number(range.desde.slice(0,4)),Number(range.desde.slice(5,7)),0)).getUTCDate();
  const days=(Date.parse(range.hasta)-Date.parse(range.desde))/86400000+1;
  const fraction=singleMonth?days/monthDays:null;
  const salarioBase=fraction==null || (payroll?.salario_base == null && config.salario_base == null)?null:money(Number(payroll?.salario_base ?? config.salario_base)*fraction);
  const ssEmpresa=salarioBase==null?null:payroll?money(Number(payroll.ss_empresa || 0)*fraction):config.ss_empresa_pct!=null?money(salarioBase*Number(config.ss_empresa_pct)/100):null;
  const ssTrabajador=salarioBase==null?null:payroll?money(Number(payroll.ss_trabajador || 0)*fraction):config.ss_trabajador_pct!=null?money(salarioBase*Number(config.ss_trabajador_pct)/100):null;
  const retencionIRPF=payroll?money(Number(payroll.irpf || 0)*fraction):null;
  const liquidoNeto=payroll?money(Number(payroll.liquido || 0)*fraction):null;
  const incentivoPct=Number(config.incentivo_pct || 0), incentivo=money(ingresos*incentivoPct/100);
  const kmPagoTipo=config.km_pago_tipo || 'todos';
  const kmRetribuidos=kmPagoTipo==='cargado'?kmCargado:kmPagoTipo==='vacio'?kmVacio:kmTotal;
  const pagoKm=money(kmRetribuidos*Number(config.precio_km || 0));
  const diasActivos=new Set([...orders.map(p=>day(p.fecha_bi)),...noches.map(n=>day(n.fecha))].filter(Boolean)).size;
  const disponibilidad=fraction==null?null:money(Number(config.disponibilidad_mensual || 0)*fraction+Number(config.disponibilidad_diaria || 0)*diasActivos);
  const totalChofer=salarioBase==null?null:money(salarioBase+incentivo+costeNoches+pagoKm+disponibilidad);
  const costeEmpresaTotal=totalChofer==null||ssEmpresa==null?null:money(totalChofer+ssEmpresa);
  const totalCostes=costeGasoil==null||costeEmpresaTotal==null?null:money(costeGasoil+costeTaller+costeEmpresaTotal);
  const hasCost=(repostajes.length+expenses.length+repairs.length)>0 || Number(salarioBase)>0;
  const margen=totalCostes==null||!hasCost?null:money(ingresos-totalCostes);
  return {pedVeh:orders,kmCargado,kmVacio,kmTotal,ingresos,viajes:orders.length,precioLitro:fuelPrice(range.desde),costeGasoil,costeTaller,costeNoches,salarioBase,ssEmpresa,ssTrabajador,retencionIRPF,liquidoNeto,incentivoPct,incentivo,kmPagoTipo,kmRetribuidos,pagoKm,diasActivos,disponibilidad,totalChofer,costeEmpresaTotal,totalCostes,margen,
    eurosKm:t.cobertura_km===orders.length?ratio(ingresos,kmTotal):null,eurosKmIngresos:t.cobertura_km===orders.length?ratio(ingresos,kmTotal):null,eurosKmMargen:t.cobertura_km===orders.length?ratio(margen,kmTotal):null,eurosKmCostes:t.cobertura_km===orders.length?ratio(totalCostes,kmTotal):null,
    metadata:reportMetadata(range,{resultado_flota:metric(margen,'Servicios realizados menos combustible, taller y conductor. Sin estructura, seguros, amortización ni conciliación de duplicados',{status:margen==null?'sin_datos':'estimado'}),nomina:metric(costeEmpresaTotal,'Imputación proporcional por días; conductor actualmente asociado. Rangos de varios meses requieren desglose mensual',{status:costeEmpresaTotal==null?'sin_datos':'estimado'}),eur_km:metric(t.cobertura_km===orders.length?ratio(ingresos,kmTotal):null,'Ingreso neto realizado / kilómetros cargados + vacíos, incluidos registros manuales',{unit:'EUR/km total',denominator:kmTotal,total:orders.length,known:t.cobertura_km})})};
}
async function readRouteSheet(empresaId,query) {
  if(!empresaId)throw Object.assign(new Error('Sin empresa'),{status:401});
  const range=reportRange(query), vehicle=query.vehiculo_id;
  const found=await db.query('SELECT * FROM vehiculos WHERE empresa_id=$1 AND id=$2',[empresaId,vehicle]);
  if(!found.rows[0])throw Object.assign(new Error('Vehículo no encontrado'),{status:404});
  const params=[empresaId,vehicle,range.desde,range.hasta];
  const orders=await db.query(`WITH ${financialPedidosCte} SELECT * FROM pedidos_bi WHERE fecha_bi BETWEEN $2 AND $3 AND vehiculo_id=$4 AND estado::text IN ('entregado','facturado')`,[empresaId,range.desde,range.hasta,vehicle]);
  // The order records the assignment at execution time. Current vehicle/driver
  // relations may have changed and must not rewrite historical labour costs.
  const historicalDrivers=[...new Set(orders.rows.map(p=>p.chofer_id).filter(Boolean))];
  const driverId=historicalDrivers.length===1 && orders.rows.every(p=>p.chofer_id) ? historicalDrivers[0] : null;
  const [repostajes,noches,expenses,workshop,config,fuel,payroll,emptyKm]=await Promise.all([
    db.query('SELECT fecha,litros,precio_litro,importe FROM vehiculo_repostajes WHERE empresa_id=$1 AND vehiculo_id=$2 AND fecha BETWEEN $3 AND $4',params),
    db.query('SELECT fecha,importe FROM vehiculo_noches WHERE empresa_id=$1 AND vehiculo_id=$2 AND fecha BETWEEN $3 AND $4',params),
    db.query('SELECT tipo,estado,importe,litros FROM chofer_gastos WHERE empresa_id=$1 AND vehiculo_id=$2 AND fecha BETWEEN $3 AND $4',params),
    db.query('SELECT data FROM taller_estado WHERE empresa_id=$1',[empresaId]),
    driverId ? db.query('SELECT * FROM chofer_config WHERE empresa_id=$1 AND chofer_id=$2',[empresaId,driverId]) : Promise.resolve({rows:[]}),
    db.query('SELECT * FROM vehiculo_gasoil_config WHERE empresa_id=$1 AND vehiculo_id=$2',[empresaId,vehicle]),
    driverId ? db.query('SELECT * FROM nominas_emitidas WHERE empresa_id=$1 AND chofer_id=$2 AND periodo::text LIKE $3 ORDER BY periodo DESC LIMIT 1',[empresaId,driverId,range.desde.slice(0,7)+'%']) : Promise.resolve({rows:[]}),
    db.query('SELECT km_vacio,notas FROM vehiculo_km_vacio WHERE empresa_id=$1 AND vehiculo_id=$2 AND fecha BETWEEN $3 AND $4',params)
  ]);
  return buildRouteSheet({range,orders:orders.rows,repostajes:repostajes.rows,noches:noches.rows,expenses:expenses.rows,emptyKm:emptyKm.rows,repairs:(workshop.rows[0]?.data?.reparaciones || []).filter(r=>r.vehiculo_id===vehicle&&day(r.fecha)>=range.desde&&day(r.fecha)<=range.hasta),config:config.rows[0] || {},fuel:fuel.rows[0] || {},payroll:payroll.rows[0]});
}
module.exports={readRouteSheet,buildRouteSheet};
