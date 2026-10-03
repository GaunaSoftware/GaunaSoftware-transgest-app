import { lazy, Suspense } from 'react';

// Orders and the commercial screens share the same point editor and validation.
const Editor = lazy(() => import('../pages/Pedidos').then(module => ({ default: module.PuntoInteresModal })));
export default function PointEditor(props) {
  return <Suspense fallback={<p role="status">Abriendo ficha del punto…</p>}><Editor {...props} /></Suspense>;
}
