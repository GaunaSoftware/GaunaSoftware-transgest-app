import { useCallback, useEffect, useState } from 'react';

export default function ClaveiconAdminSummary({ empresaId, request, defaultOpen = false }) {
  const [value, setValue] = useState(null);
  const [key, setKey] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await request(`/integraciones/fiscal/${empresaId}/claveicon`);
    setValue(result);
    setCode(result.config?.codemp || '');
  }, [empresaId, request]);

  useEffect(() => {
    let active = true;
    setValue(null);
    setKey('');
    setCode('');
    setMessage('');
    setError('');
    request(`/integraciones/fiscal/${empresaId}/claveicon`)
      .then(result => { if (active) { setValue(result); setCode(result.config?.codemp || ''); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [empresaId, request]);

  async function saveCredential(event) {
    event.preventDefault();
    setBusy('save');
    setError('');
    setMessage('');
    try {
      await request(`/integraciones/fiscal/${empresaId}/claveicon/credencial`, {
        method: 'PUT', body: { api_key: key.trim(), codemp: code.trim().toUpperCase() },
      });
      setKey('');
      await load();
      setMessage('Clave privada guardada para esta empresa. Comprueba la conexión antes de activar importaciones.');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function testConnection() {
    setBusy('test');
    setError('');
    setMessage('');
    try {
      const result = await request(`/integraciones/fiscal/${empresaId}/claveicon/probar-conexion`, { method: 'POST' });
      if (!result.ok) {
        setError(result.http_status === 401
          ? 'ClaveiCon no ha aceptado la clave privada (HTTP 401). Comprueba que has guardado la API key de ClaveiCon de esta empresa, completa y vigente; si persiste, pide al proveedor que confirme su activación.'
          : `ClaveiCon respondió HTTP ${result.http_status}. No se ha podido confirmar la conexión.`);
      } else if (!result.company_list_recognized) {
        setError('Conexión HTTP correcta, pero el listado de empresas tiene un formato no reconocido. No se ha activado la importación.');
      } else if (!result.company_visible) {
        setError(`Conexión correcta, pero no aparece la empresa ${result.expected_code}. No se ha activado la importación.`);
      } else {
        setMessage(`Conexión correcta: la empresa ${result.expected_code} aparece en ClaveiCon. La importación automática sigue pendiente de validación.`);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  const cfg = value?.config || {};
  return <details open={defaultOpen || undefined} className="sa-claveicon-summary">
    <summary>
      ClaveiCon · {cfg.enabled ? 'Configurado' : 'Sin activar'} · {value?.pending || 0} pendientes · {value?.errors || 0} errores
    </summary>
    {!value && !error && <p>Consultando ClaveiCon…</p>}
    {value && <>
      <dl>
        {[
          ['Modo', cfg.mode === 'api' ? 'API (importación pendiente de validar)' : 'XML manual'],
          ['Empresa ClaveiCon', cfg.codemp || 'Sin configurar'],
          ['Credencial de esta empresa', value.credential_configured ? `Configurada (${value.credential_mask})` : 'Sin configurar'],
          ['Última sincronización', value.last_synced_at ? new Date(value.last_synced_at).toLocaleString('es-ES') : 'Sin importaciones confirmadas'],
        ].map(([label, content]) => <div key={label}>
          <dt>{label}</dt>
          <dd>{content}</dd>
        </div>)}
      </dl>
      <p className="sa-claveicon-help">Servidor: <a href="https://gateway.claveicowork.com/api/v1" target="_blank" rel="noreferrer">https://gateway.claveicowork.com/api/v1</a>. La prueba lista las empresas disponibles («List ERP companies»). Utiliza el código de empresa que haya activado ClaveiCon para esta conexión.</p>
      <form onSubmit={saveCredential} autoComplete="off">
        <label className="sa-claveicon-code">
          Código ClaveiCon
          <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            maxLength={5} required pattern="[A-Z0-9]{1,5}" />
        </label>
        <label className="sa-claveicon-key">
          API key privada de esta empresa
          <input type="password" value={key} onChange={e => setKey(e.target.value)}
            placeholder={value.credential_configured ? 'Guardada; deja vacío para conservar' : 'Pegar clave completa'} autoComplete="new-password" />
        </label>
        <button type="submit" className="sa-action sa-action-primary" disabled={!!busy || !code.trim() || (!key.trim() && !value.credential_configured)}>{busy === 'save' ? 'Guardando…' : 'Guardar configuración'}</button>
        <button type="button" className="sa-action" onClick={testConnection} disabled={!!busy || !value.credential_configured || !cfg.codemp}>
          {busy === 'test' ? 'Comprobando…' : 'Probar conexión'}
        </button>
      </form>
      <p className="sa-claveicon-help">Solo SuperAdmin puede guardar esta clave. La prueba consulta empresas; no envía facturas ni asientos.</p>
    </>}
    {error && <p role="alert" className="sa-claveicon-error">{error}</p>}
    {message && <p role="status" className="sa-claveicon-message">{message}</p>}
  </details>;
}
