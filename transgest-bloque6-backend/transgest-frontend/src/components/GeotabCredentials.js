import {useState} from 'react';
export function parseGeotabCredentials(text){
  let json;try{json=JSON.parse(text);}catch{throw Error('El archivo no contiene un JSON válido.');}
  const values=json?.params||json?.credentials||json;
  const database=typeof values?.database==='string'?values.database.trim():'';
  const userName=typeof (values?.userName??values?.username)==='string'?(values.userName??values.username).trim():'';
  const password=typeof values?.password==='string'?values.password:'';
  if(!database||!userName||!password)throw Error('El JSON debe contener database, userName y password. Una sesión temporal o una API key de otro producto no sustituyen esos datos.');
  return {database,userName,password};
}
export default function GeotabCredentials({value,onChange,configured,disabled,inputStyle}){
  const [error,setError]=useState('');
  let fields={database:'',userName:'',password:''};
  try{fields={...fields,...JSON.parse(value||'{}')};}catch{}
  const change=(key,text)=>{setError('');onChange(JSON.stringify({...fields,[key]:text}));};
  async function importFile(file){
    if(!file)return;
    try{
      if(file.size>64*1024)throw Error('El JSON de credenciales debe ocupar menos de 64 KB.');
      const values=parseGeotabCredentials(await file.text());onChange(JSON.stringify(values));setError('');
    }catch(cause){setError(cause.message||'No se pudo leer el archivo JSON.');}
  }
  return <section className="sa-geotab-credentials">
    <h4>Acceso de MyGeotab</h4>
    <p>Rellena los tres campos o carga el JSON entregado por tu proveedor. Los datos se guardan cifrados para la empresa seleccionada; no se recupera la contraseña en pantalla.</p>
    {configured&&<p>Hay credenciales guardadas. Deja los campos vacíos para conservarlas.</p>}
    <div className="sa-geotab-fields">
      <label>Base de datos<input aria-label="Base de datos Geotab" autoComplete="off" style={inputStyle} value={fields.database||''} onChange={e=>change('database',e.target.value)} disabled={disabled}/></label>
      <label>Usuario de MyGeotab<input aria-label="Usuario Geotab" autoComplete="off" style={inputStyle} value={fields.userName||''} onChange={e=>change('userName',e.target.value)} disabled={disabled}/></label>
      <label>Contraseña<input aria-label="Contraseña Geotab" type="password" autoComplete="new-password" style={inputStyle} value={fields.password||''} onChange={e=>change('password',e.target.value)} disabled={disabled}/></label>
    </div>
    <label className="sa-geotab-import">Cargar archivo JSON<input aria-label="Archivo JSON Geotab" type="file" accept=".json,application/json" disabled={disabled} onChange={e=>{importFile(e.target.files?.[0]);e.target.value='';}}/></label>
    <small>El usuario debe poder consultar vehículos y posiciones (Device y DeviceStatusInfo). Después pulsa Guardar GPS activo y Diagnosticar.</small>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
