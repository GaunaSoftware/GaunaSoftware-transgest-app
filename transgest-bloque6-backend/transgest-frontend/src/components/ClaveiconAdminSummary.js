import { useCallback, useEffect, useState } from 'react';

const buttonStyle = { minHeight: 36, padding: '8px 12px', borderRadius: 7, border: '1px solid #0f766e', background: '#0f766e', color: '#fff', fontWeight: 700, cursor: 'pointer' };
const secondaryButtonStyle = { ...buttonStyle, background: '#172338', borderColor: '#475569', color: '#e2e8f0' };

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
        setError(`ClaveiCon respondió HTTP ${result.http_status}. Revisa la credencial de esta empresa.`);
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
  return <details open={defaultOpen || undefined} style={{ marginTop: 16, color: '#e2e8f0', maxWidth: 780 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
      ClaveiCon · {cfg.enabled ? 'Configurado' : 'Sin activar'} · {value?.pending || 0} pendientes · {value?.errors || 0} errores
    </summary>
    {!value && !error && <p>Consultando ClaveiCon…</p>}
    {value && <>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
        {[
          ['Modo', cfg.mode === 'api' ? 'API (importación pendiente de validar)' : 'XML manual'],
          ['Empresa ClaveiCon', cfg.codemp || 'Sin configurar'],
          ['Credencial de esta empresa', value.credential_configured ? `Configurada (${value.credential_mask})` : 'Sin configurar'],
          ['Última sincronización', value.last_synced_at ? new Date(value.last_synced_at).toLocaleString('es-ES') : 'Sin importaciones confirmadas'],
        ].map(([label, content]) => <div key={label}>
          <dt style={{ color: '#94a3b8', fontSize: 11 }}>{label}</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>{content}</dd>
        </div>)}
      </dl>
      <form onSubmit={saveCredential} autoComplete="off" style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 12 }}>
        <label style={{ flex: '0 1 160px', fontSize: 12 }}>
          Código ClaveiCon
          <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            maxLength={5} required pattern="[A-Z0-9]{1,5}"
            style={{ display: 'block', boxSizing: 'border-box', width: '100%', minHeight: 36, marginTop: 5, padding: '8px 10px', borderRadius: 7, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
        </label>
        <label style={{ flex: '1 1 280px', fontSize: 12 }}>
          API key privada de esta empresa
          <input type="password" value={key} onChange={e => setKey(e.target.value)}
            placeholder="Pegar clave completa" autoComplete="new-password"
            style={{ display: 'block', boxSizing: 'border-box', width: '100%', minHeight: 36, marginTop: 5, padding: '8px 10px', borderRadius: 7, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
        </label>
        <button type="submit" style={buttonStyle} disabled={!!busy || !code.trim() || (!key.trim() && !value.credential_configured)}>{busy === 'save' ? 'Guardando…' : 'Guardar configuración'}</button>
        <button type="button" style={secondaryButtonStyle} onClick={testConnection} disabled={!!busy || !value.credential_configured || !cfg.codemp}>
          {busy === 'test' ? 'Comprobando…' : 'Probar conexión'}
        </button>
      </form>
      <p style={{ color: '#94a3b8', fontSize: 12 }}>Solo SuperAdmin puede guardar esta clave. La prueba consulta empresas; no envía facturas ni asientos.</p>
    </>}
    {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
    {message && <p role="status" style={{ color: '#5eead4' }}>{message}</p>}
  </details>;
}
