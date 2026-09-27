import { useState } from 'react';
import { downloadStoredDocument } from '../services/api';
import { notify } from '../services/notify';

export default function StoredDocumentButton({ doc, scope, style }) {
  const [busy, setBusy] = useState(false);
  if (!doc.storage_key) return doc.file_url
    ? <a href={doc.file_url} target="_blank" rel="noreferrer" style={style}>Abrir</a>
    : null;
  async function download() {
    setBusy(true);
    let url;
    try {
      const blob = await downloadStoredDocument(scope, doc.id);
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.file_name || doc.file_nombre || 'documento.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      notify(error.message || 'No se pudo descargar el documento', 'error');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBusy(false);
    }
  }
  return <button type="button" style={style} disabled={busy} onClick={download}>
    {busy ? 'Descargando…' : 'Descargar'}
  </button>;
}
