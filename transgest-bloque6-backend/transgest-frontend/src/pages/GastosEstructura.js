import { useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { getResumenGastosEstructura, crearGastoEstructura, editarGastoEstructura, borrarGastoEstructura, cambiarVigenciaGasto,
  getMesesCerrados, cerrarMes, abrirMes } from '../services/api';
import { confirmDialog, notify } from '../services/notify';
import { useAuth } from '../context/AuthContext';
import { Page, PageHeader, Section, Button, Badge, KpiCard, Tabs, DataTable, MobileDataCard, EmptyState, Modal } from '../ui';
import './GastosEstructura.css';

const euros = n => n == null ? 'Sin datos' : Number(n).toLocaleString('es-ES', {style:'currency',currency:'EUR'});
const percent = n => n == null ? 'No calculable' : Number(n).toLocaleString('es-ES',{maximumFractionDigits:1}) + ' %';
const monthLabel = month => new Date(month+'-15T12:00:00Z').toLocaleDateString('es-ES',{month:'long',year:'numeric',timeZone:'Europe/Madrid'});
const monthTick = month => new Date(month+'-15T12:00:00Z').toLocaleDateString('es-ES',{month:'short',year:'2-digit',timeZone:'Europe/Madrid'});
const currentMonth = () => {
  const parts = new Intl.DateTimeFormat('en',{year:'numeric',month:'2-digit',timeZone:'Europe/Madrid'}).formatToParts(new Date());
  return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
};
const TYPES = ['Salario personal oficina','Alquiler/Arrendamiento','Suministros (luz, agua, internet)','Seguros empresa','Asesoría/Gestoría','Marketing/Publicidad','Viajes de negocio','Formación','Software/Licencias','Otros gastos generales'];
const FREQUENCIES = {mensual:'Todos los meses',unico:'Puntual',trimestral:'Trimestral',anual:'Anual'};
const changes = v => !v || v.diferencia == null ? 'Sin datos comparables' : (v.diferencia > 0 ? '+' : '')+euros(v.diferencia)+' · '+percent(v.porcentaje);

function ExpenseForm({expense,month,onClose,onSaved,ending=false}) {
  const [form,setForm] = useState(expense || {nombre:'',tipo:TYPES[0],importe:'',periodo:'mensual',fecha:month,notas:''});
  const recurrent=Boolean(expense && expense.periodo!=='unico');
  const [effective,setEffective]=useState(month);
  const [reason,setReason]=useState('');
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const field = key => event => setForm(previous=>({...previous,[key]:event.target.value}));
  const close = () => { if (!saving) onClose(); };
  async function save(event) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const payload = {...form,nombre:form.nombre.trim(),importe:Number(form.importe)};
      if(recurrent) await cambiarVigenciaGasto(expense.id,{accion:ending?'finalizar':'cambiar',revision:expense.revision,desde:effective,hasta:effective,motivo:reason,datos:payload});
      else if (expense?.id) await editarGastoEstructura(expense.id,payload);
      else await crearGastoEstructura(payload);
      onSaved();
    } catch (e) { setError(e.message || 'No se pudo guardar el gasto.'); }
    finally { setSaving(false); }
  }
  return <Modal open title={ending?'Finalizar recurrencia':recurrent?'Cambiar gasto desde un mes':expense ? 'Editar gasto' : 'Añadir gasto de estructura'} onClose={close} width={620}
    footer={<><Button disabled={saving} onClick={close}>Cancelar</Button><Button variant="primary" type="submit" form="structure-expense-form" disabled={saving}>{saving ? 'Guardando…' : 'Guardar gasto'}</Button></>}>
    <form id="structure-expense-form" className="structure-expense-form" onSubmit={save}>
      {error && <p role="alert" className="structure-full">{error}</p>}
      {recurrent && <><label>{ending?'Último mes incluido':'Aplicar desde el mes'}<input className="tgui-input" type="month" required min={expense.vigente_desde || String(expense.fecha).slice(0,7)} value={effective} onChange={e=>setEffective(e.target.value)}/></label>
        <label className="structure-full">Motivo del cambio<textarea className="tgui-input" required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <p className="structure-full structure-muted">Los meses anteriores conservan sus importes. {ending?'Este será el último mes que incluya el gasto.':'Se registra una nueva vigencia con tu usuario y el motivo.'}</p></>}
      {!ending && <>
      <label className="structure-full">Nombre / descripción<input className="tgui-input" required maxLength={200} value={form.nombre} onChange={field('nombre')} placeholder="Ej.: alquiler de oficina"/></label>
      <label className="structure-full">Categoría<select className="tgui-input" value={form.tipo} onChange={field('tipo')}>{!TYPES.includes(form.tipo) && <option>{form.tipo}</option>}{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
      <label>Importe (€)<input className="tgui-input" type="number" required min="0.01" step="0.01" value={form.importe} onChange={field('importe')}/></label>
      <label>Frecuencia<select className="tgui-input" value={form.periodo} onChange={field('periodo')}>{Object.entries(FREQUENCIES).filter(([v])=>!recurrent || v!=='unico').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {!recurrent && <label>{form.periodo==='unico' ? 'Mes del gasto' : 'Desde el mes'}<input className="tgui-input" type="month" required value={String(form.fecha).slice(0,7)} onChange={field('fecha')}/></label>}
      <label className="structure-full">Notas<textarea className="tgui-input" rows={3} value={form.notas || ''} onChange={field('notas')}/></label>
      <p className="structure-full structure-muted">{form.periodo==='unico' ? 'Se incluye únicamente en el mes indicado.' : 'Se incluye desde el mes indicado en adelante.'} {['anual','trimestral'].includes(form.periodo) && 'El importe se reparte entre los meses de la frecuencia elegida.'}</p>
      </>}
    </form>
  </Modal>;
}

function Comparison({data}) {
  if (!data) return <EmptyState title="Comparativa no disponible" text="La API debe incluir el resumen comparativo para este periodo."/>;
  const periods = data.periodos;
  const labels = ['Mes seleccionado','Mes anterior','Mismo mes del año anterior'];
  const chart = periods.map((p,i)=>({...p,label:monthLabel(p.periodo),referencia:labels[i]}));
  const columns = [{key:'tipo',label:'Categoría'},
    ...['actual','anterior','ano_anterior'].map((key,i)=>({key,label:monthLabel(periods[i].periodo),render:row=>euros(row[key]),className:'tgui-number'})),
    {key:'variacion_anterior',label:'Variación mensual',render:row=>changes(row.variacion_anterior)},
    {key:'variacion_anual',label:'Variación interanual',render:row=>changes(row.variacion_anual)}];
  return <>
    <div className="structure-kpis">
      {periods.map((p,i)=><KpiCard key={p.periodo} icon="coins" label={labels[i]} value={euros(p.total)} detail={monthLabel(p.periodo)+' · '+p.registros+' gastos registrados'}/>)}
    </div>
    <div className="structure-comparison-grid">
      <Section title="Comparación de gastos mensuales">
        <p className="structure-muted">Importe imputado en euros · meses naturales completos</p>
        <p className="structure-legend"><span aria-hidden="true"/> Gastos de estructura registrados (€)</p>
        {periods.some(p=>p.total!=null) ? <div className="structure-chart" role="img" aria-label="Comparación de gastos de estructura. Los valores completos están en la tabla de periodos.">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{top:12,right:12,left:8,bottom:20}}>
            <CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="periodo" tickFormatter={monthTick} tick={{fill:'var(--text3)',fontSize:11}} interval={0} height={48}/>
            <YAxis tick={{fill:'var(--text3)',fontSize:11}} width={72} tickFormatter={n=>n.toLocaleString('es-ES')+' €'}/>
            <Tooltip labelFormatter={monthLabel} formatter={n=>[euros(n),'Gastos de estructura']} contentStyle={{background:'var(--card-bg)',borderColor:'var(--border)',color:'var(--text)'}}/>
            <Bar dataKey="total" name="Gastos de estructura (€)" fill="var(--accent)" radius={[5,5,0,0]} maxBarSize={70}/>
          </BarChart></ResponsiveContainer>
        </div> : <EmptyState title="Sin gastos registrados en los periodos comparados"/>}
      </Section>
      <Section title="Variaciones">
        <div className="structure-variation"><span>Respecto al mes anterior</span><strong>{changes(data.variacion_anterior)}</strong></div>
        <div className="structure-variation"><span>Respecto al mismo mes del año anterior</span><strong>{changes(data.variacion_anual)}</strong></div>
        <p className="structure-muted">Una variación positiva indica un aumento de gastos. Sin un importe de referencia válido no se calcula el porcentaje.</p>
        <Badge tone="warning">Cobertura parcial: gastos registrados</Badge>
      </Section>
    </div>
    <Section title="Datos del gráfico">
      <DataTable rows={chart} rowKey={r=>r.periodo} columns={[{key:'referencia',label:'Comparación'},{key:'label',label:'Mes'},{key:'total',label:'Gastos (€)',render:r=>euros(r.total)},{key:'registros',label:'Gastos registrados'}]}/>
    </Section>
    <Section title="Desglose por categoría"><DataTable rows={data.categorias} rowKey={r=>r.tipo} columns={columns} emptyTitle="Sin categorías para comparar"/></Section>
    <Section title="Definición y alcance">
      <details><summary>Cómo se calcula la comparativa</summary><p>{data.definicion}</p><p>{data.impuestos}</p><p>{data.cobertura}</p><p>{data.alcance}</p>
        <p>Actualizado: {new Date(data.generado_at).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})} · Versión: {data.version}</p>
      </details>
    </Section>
  </>;
}

export default function GastosEstructura() {
  const {user,puedeEditar} = useAuth();
  const canEdit = ['gerente','contable'].includes(user?.rol) && Boolean(puedeEditar?.('gastos_estructura'));
  const [month,setMonth] = useState(currentMonth);
  const [tab,setTab] = useState('gestion');
  const [allocation,setAllocation] = useState('igual');
  const [revision,setRevision] = useState(0);
  const [modal,setModal] = useState(null);
  const [busy,setBusy] = useState(false);
  const [result,setResult] = useState({month:null,data:null,closed:[],error:'',loading:true});
  useEffect(()=>{
    let active = true;
    setResult({month,data:null,closed:[],error:'',loading:true});
    Promise.all([getResumenGastosEstructura(month),getMesesCerrados()]).then(([data,closed])=>{
      if(active) setResult({month,data,closed:closed.map(m=>String(m).slice(0,7)),error:'',loading:false});
    }).catch(e=>{if(active) setResult({month,data:null,closed:[],error:e.message || 'No se pudieron cargar los gastos.',loading:false});});
    return ()=>{active=false;};
  },[month,revision]);
  const ready = result.month===month && !result.loading && !result.error;
  const data = ready ? result.data : null;
  const closed = result.closed.includes(month);
  const editable = canEdit && ready && !closed && !busy;
  const refresh = () => setRevision(n=>n+1);
  async function mutate(fn) {
    setBusy(true);
    try { await fn(); refresh(); }
    catch(e) { notify(e.message || 'No se pudo completar la operación.','error'); }
    finally { setBusy(false); }
  }
  async function toggleClosed() {
    if(await confirmDialog({title:closed?'Reabrir mes':'Cerrar mes',message:closed?'Permitir cambios en '+monthLabel(month)+'.':'Bloquear la edición de los gastos de '+monthLabel(month)+'.',confirmText:closed?'Reabrir':'Cerrar mes',tone:'warning'})) {
      await mutate(()=>closed?abrirMes(month):cerrarMes(month));
    }
  }
  async function remove(expense) {
    if(await confirmDialog({title:'Eliminar gasto',message:'Eliminar «'+expense.nombre+'»'+(expense.periodo!=='unico'?' y su recurrencia':'')+'?',confirmText:'Eliminar',tone:'danger'})) await mutate(()=>borrarGastoEstructura(expense.id));
  }
  async function attach(expense,file) {
    if(!file) return;
    await mutate(async()=>{
      const content = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.readAsDataURL(file);});
      await editarGastoEstructura(expense.id,{factura_nombre:file.name,factura_data:content});
    });
  }
  const actions = expense => <div className="tgui-actions">
    {expense.factura_nombre && expense.factura_data && <a className="tgui-button" href={expense.factura_data} download={expense.factura_nombre}>Ver justificante</a>}
    {editable && <><label className="tgui-button structure-upload">{expense.factura_nombre ? 'Cambiar justificante' : 'Adjuntar justificante'}<input aria-label={'Adjuntar justificante de '+expense.nombre} type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" onChange={e=>attach(expense,e.target.files[0])}/></label>
      {!expense.fecha_fin && <Button onClick={()=>setModal({expense})}>{expense.periodo==='unico'?'Editar':'Cambiar desde un mes'}</Button>}
      {expense.periodo==='unico'?<Button onClick={()=>remove(expense)}>Eliminar</Button>:!expense.fecha_fin && <Button onClick={()=>setModal({expense,ending:true})}>Finalizar recurrencia</Button>}</>}
    {expense.fecha_fin && <Badge>Finaliza en {monthLabel(expense.fecha_fin)}</Badge>}
    {expense.vigencias?.length>0 && <details><summary>Historial de vigencias</summary>{expense.vigencias.map(v=><p key={v.desde}>{monthLabel(v.desde)}: {euros(v.datos.importe)} · {FREQUENCIES[v.datos.periodo]} · {v.motivo}</p>)}</details>}
  </div>;
  const rows = (data?.reparto || []).map(row=>({...row,id:row.v.id,matricula:row.v.matricula,
    coste:allocation==='igual'?row.coste_igual:row.coste_ingresos,peso:allocation==='igual'?row.peso_igual:row.peso_ingresos}));
  const unallocated = allocation==='igual'?data?.no_atribuido_igual:data?.no_atribuido_ingresos;
  return <Page className="structure-expenses">
    <PageHeader title="Gastos de estructura" description="Gestiona los gastos generales y su reparto entre camiones."
      actions={canEdit && <Button variant="primary" disabled={!editable} onClick={()=>setModal({expense:null})}>+ Añadir gasto</Button>}/>
    <div className="structure-expenses-controls">
      <label>Periodo<input className="tgui-input" type="month" value={month} onChange={e=>{if(/^\d{4}-\d{2}$/.test(e.target.value))setMonth(e.target.value);}}/></label>
      <div className="tgui-actions">{ready && <Badge tone={closed?'warning':'success'}>{closed?'Mes cerrado':'Mes abierto'}</Badge>}
        {canEdit && <Button onClick={toggleClosed} disabled={!ready || busy}>{closed?'Reabrir mes':'Cerrar mes'}</Button>}
      </div>
    </div>
    <Tabs idPrefix="structure" label="Gastos de estructura" items={[{value:'gestion',label:'Gestión de gastos'},{value:'comparativa',label:'Comparativa'}]} value={tab} onChange={setTab}/>
    <div id="structure-panel" role="tabpanel" aria-labelledby={'structure-'+tab}>
      {!ready && !result.error && <p role="status">Cargando gastos…</p>}
      {result.error && <Section title="No se han podido cargar los gastos"><p role="alert">{result.error}</p><Button onClick={refresh}>Reintentar</Button></Section>}
      {data && (tab==='comparativa' ? <Comparison data={data.comparativa}/> : <>
        <div className="structure-kpis">
          <KpiCard icon="wallet" label="Gastos del mes" value={euros(data.total)} detail={monthLabel(month)}/>
          <KpiCard icon="truck" label="Camiones activos" value={rows.length} detail="Flota actual · remolques excluidos"/>
          <KpiCard icon="coins" label="Coste medio por camión" value={euros(data.coste_medio_camion)} detail="Gastos del mes / camiones activos"/>
        </div>
        <Section title="Gastos del periodo" actions={<Badge>{data.gastos.length} gastos</Badge>}>
          <DataTable rows={data.gastos} columns={[{key:'nombre',label:'Concepto'},{key:'tipo',label:'Categoría'},{key:'periodo',label:'Frecuencia',render:g=>FREQUENCIES[g.periodo] || g.periodo},
            {key:'importe_periodo',label:'Importe del mes',render:g=>euros(g.importe_periodo),className:'tgui-number'},{key:'acciones',label:'Acciones',render:actions}]}
            renderMobile={g=><MobileDataCard title={g.nombre} amount={euros(g.importe_periodo)} subtitle={g.tipo} actions={actions(g)}><Badge>{FREQUENCIES[g.periodo]}</Badge></MobileDataCard>}
            emptyTitle={'Sin gastos registrados en '+monthLabel(month)}/>
          {data.gastos.length>0 && <p className="structure-total">Total del mes <strong>{euros(data.total)}</strong></p>}
        </Section>
        <Section title="Reparto por camión" actions={<label className="structure-allocation-filter">Criterio<select className="tgui-input" value={allocation} onChange={e=>setAllocation(e.target.value)}><option value="igual">A partes iguales</option><option value="ingresos">Según ingresos de los camiones</option></select></label>}>
          {data.total==null ? <EmptyState title="Añade gastos para calcular el reparto"/> : <>
            {unallocated>0 && <p role="status">Sin repartir: <strong>{euros(unallocated)}</strong>. No hay camiones elegibles o ingresos válidos para el criterio elegido.</p>}
            <DataTable rows={rows} columns={[{key:'matricula',label:'Camión'},{key:'peso',label:'Porcentaje',render:r=>percent(r.peso==null?null:r.peso*100)},{key:'coste',label:'Gastos asignados',render:r=>euros(r.coste),className:'tgui-number'}]}
              emptyTitle="Sin camiones activos para repartir los gastos"/>
            <details className="structure-method"><summary>Ver criterio de reparto</summary><p>{data.base_reparto}. A partes iguales, cada camión recibe la misma proporción. La asignación utiliza la flota activa actual.</p></details>
          </>}
        </Section>
      </>)}
    </div>
    {modal && <ExpenseForm expense={modal.expense} ending={modal.ending} month={month} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);refresh();}}/>}
  </Page>;
}
