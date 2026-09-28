import {useEffect, useState} from 'react';
import {getChoferResumenMensualApp} from '../../services/api';
import {DriverHeading} from './DriverUI';

const madridMonth = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit'}).format(new Date());
const number = value => new Intl.NumberFormat('es-ES',{maximumFractionDigits:1}).format(value);
const euros = value => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(value);

export default function DriverMonthlySummary(){
  const [mes,setMes]=useState(madridMonth);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');setData(null);
    getChoferResumenMensualApp(mes).then(result=>{if(active)setData(result);})
      .catch(err=>{if(active)setError(err.message||'No se pudo cargar el resumen mensual.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[mes]);
  return <div className="driver-section-shell driver-monthly-summary">
    <section className="driver-card">
      <DriverHeading icon="historial" title="Mi mes">Kilómetros y noches registrados al cerrar tus jornadas.</DriverHeading>
      <label htmlFor="driver-summary-month" style={{display:'block',margin:'14px 0 6px',fontWeight:700}}>Mes</label>
      <input id="driver-summary-month" type="month" value={mes} onChange={event=>setMes(event.target.value)} max={madridMonth()} />
      {loading && <p role="status">Cargando resumen…</p>}
      {error && <p role="alert">{error}</p>}
      {data && <>
        <div className="driver-summary-grid" style={{marginTop:14}}>
          <div><span>Kilómetros recorridos</span><strong>{data.km_recorridos == null ? 'Sin datos' : `${number(data.km_recorridos)} km`}</strong></div>
          <div><span>Noches fuera</span><strong>{number(data.noches_fuera)}</strong></div>
        </div>
        <p>{data.jornadas_cerradas} jornadas cerradas en el mes. {data.cobertura_km == null ? 'Sin lecturas válidas de kilómetros.' : `${data.jornadas_con_km} con lectura de kilómetros (${number(data.cobertura_km*100)} % de cobertura).`}</p>
        {data.jornadas > data.jornadas_cerradas && <p>Hay {data.jornadas-data.jornadas_cerradas} jornada(s) abierta(s); sus kilómetros aún no se suman.</p>}
      </>}
    </section>
    {data && <section className="driver-card" style={{marginTop:12}}>
      <DriverHeading icon="documento" title="Mi nómina"/>
      {data.nomina?.estado==='emitida' ? <>
        <p>Nómina registrada para {mes}: <strong>{data.nomina.liquido == null ? 'importe no informado' : euros(Number(data.nomina.liquido))}</strong> líquidos.</p>
        <p>El documento oficial no está adjunto a este registro. Solicítalo a administración si necesitas descargarlo.</p>
      </> : <p>{data.nomina ? 'Hay un borrador, pero la nómina todavía no está emitida.' : 'Aún no hay una nómina emitida para este mes.'}</p>}
    </section>}
  </div>;
}
