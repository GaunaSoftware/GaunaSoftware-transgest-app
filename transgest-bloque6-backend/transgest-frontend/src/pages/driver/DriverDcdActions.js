import { DriverIcon } from './DriverUI';
export default function DriverDcdActions({ onView, onQr, onShare, onPrint, onDownload, onReview, reviewed }) {
  return <div className="driver-dcd-actions"><div className="driver-dcd-primary">{[["Ver DCD",onView,"documento"],["Ver QR",onQr,"qr"],["Compartir",onShare,"compartir"]].map(([label,run,icon])=><button key={label} onClick={run}><DriverIcon name={icon}/><span>{label}</span></button>)}</div><details className="driver-details"><summary>Más opciones del documento</summary><div className="driver-action-grid"><button onClick={onPrint}>Imprimir</button><button onClick={onDownload}>Descargar</button><button onClick={onReview}>{reviewed?'DCD revisado y disponible':'Marcar revisado y disponible'}</button></div></details></div>;
}
