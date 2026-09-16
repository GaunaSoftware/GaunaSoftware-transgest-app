const db=require('./db');
const email=require('./email');
const backup=require('./backup');

// Read-only observations. A saved credential is never treated as a successful test.
async function readTechnicalHealth(){
  const now=new Date().toISOString(),checks=[];
  async function collect(key,label,fn){
    try {checks.push({key,label,...await fn()});}
    catch {checks.push({key,label,state:'error',checked_at:now,detail:'No se pudo comprobar este servicio. Revisa los registros del backend.'});}
  }
  await collect('database','Base de datos',async()=>{await db.query('SELECT 1');return {state:'ok',checked_at:now,detail:'Conexión y consulta correctas.'};});
  await collect('schema','Esquema de la actualización',async()=>{
    const required=['factura_revisiones','soporte_solicitudes','soporte_mensajes','cobros_envios','colaborador_liquidacion_tokens'];
    const {rows}=await db.query('SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) name',[required]);
    const missing=rows.filter(row=>!row.present).map(row=>row.name);
    return {state:missing.length?'error':'ok',checked_at:now,detail:missing.length?'Faltan tablas: '+missing.join(', '):'Tablas principales presentes. El endpoint /health comprueba los errores del arranque.'};
  });
  await collect('smtp','Correo de plataforma',async()=>{
    const cfg=await email.getPlatformEmailConfig();
    return {state:cfg.last_test_at?(cfg.last_test_ok===true?'ok':'error'):'pending',checked_at:cfg.last_test_at||null,
      detail:cfg.last_test_at?(cfg.last_test_ok===true?'Último envío de prueba confirmado.':'El último envío de prueba falló.'):'Pendiente de un envío de prueba. Una configuración guardada no verifica la entrega.'};
  });
  for(const [key,label,providers] of [['ai','IA / Intelligence',['openai','anthropic','ai_generic']],['routes','Rutas y distancias',['here','ors','google']],['gps','GPS',['movildata','locatel','tacogest','gps_generic']]]){
    await collect(key,label,async()=>{
      const {rows}=await db.query(`SELECT a.created_at,a.detalle->>'ok' AS ok,a.detalle->>'provider' AS provider,e.nombre AS empresa
        FROM audit_log_saas a LEFT JOIN empresas e ON e.id=a.empresa_id
        WHERE a.accion IN ('integracion.global.test','integracion.empresa.test') AND a.detalle->>'provider'=ANY($1::text[])
        ORDER BY a.created_at DESC LIMIT 1`,[providers]);
      const last=rows[0];
      return {state:last?(last.ok==='true'?'recorded':'error'):'pending',checked_at:last?.created_at||null,
        detail:last?`Última prueba: ${last.provider} · ${last.empresa||'plataforma'} · ${last.ok==='true'?'correcta':'fallida'}. Repite por empresa tras cambiar su configuración.`:'Sin pruebas registradas. Usa Probar conexión en Integraciones.'};
    });
  }
  await collect('fiscal','Envíos fiscales',async()=>{
    const {rows}=await db.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE estado_envio='error')::int AS errors FROM factura_registros_fiscales");
    return {state:rows[0].errors?'error':'pending',checked_at:now,detail:rows[0].errors?`${rows[0].errors} registros con error de envío.`:'Sin errores registrados. Esto no sustituye una prueba del proveedor fiscal por empresa.'};
  });
  await collect('backup','Copias y recuperación',async()=>{
    const status=backup.getBackupStatus();
    return {state:'pending',checked_at:status.last_backup?.created||null,detail:`${status.backups_count} copias locales. ${status.message} ${status.encryption}`};
  });
  return {checked_at:now,checks};
}
module.exports={readTechnicalHealth};
