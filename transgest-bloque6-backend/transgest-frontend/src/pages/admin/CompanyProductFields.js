import { useId } from 'react';

export const productModeForPlan = plan => plan === 'planner' ? 'planner' : plan === 'pro_planner' ? 'combinado' : 'transgest';
export const editionLabel = plan => ({lite:'Go',basico:'Pro · licencia anterior',profesional:'Pro',enterprise:'Pro Intelligence',pro_planner:'Pro'})[plan] || plan;

export function CompanyProductBadge({ company }) {
  const mode = company.modalidad || productModeForPlan(company.plan);
  return <div className="sa-product-badges">
    {mode !== 'planner' && <span>TransGest <strong>{editionLabel(company.plan)}</strong></span>}
    {mode !== 'transgest' && <span>Planner</span>}
  </div>;
}

export default function CompanyProductFields({plan,modalidad,onChange,disabled=false}) {
  const id = useId();
  const product = modalidad === 'planner' ? 'planner' : 'transgest';
  const edition = ['basico','pro_planner'].includes(plan) ? 'profesional' : plan;
  function changeProduct(value) {
    onChange({plan:value === 'planner' ? 'planner' : 'profesional',modalidad:value});
  }
  function changeExtra(enabled) {
    onChange({plan:plan === 'pro_planner' && !enabled ? 'profesional' : plan,modalidad:enabled ? 'combinado' : 'transgest'});
  }
  return <fieldset className="sa-product-fields" disabled={disabled}>
    <legend>Producto y versión</legend>
    <div className="sa-product-grid">
      <label htmlFor={`${id}-product`}>Producto
        <select id={`${id}-product`} value={product} onChange={e=>changeProduct(e.target.value)}>
          <option value="transgest">TransGest</option><option value="planner">Planner</option>
        </select>
      </label>
      {product === 'transgest' && <label htmlFor={`${id}-edition`}>Versión de TransGest
        <select id={`${id}-edition`} value={edition} onChange={e=>onChange({plan:e.target.value,modalidad})}>
          <option value="lite">Go</option><option value="profesional">Pro</option><option value="enterprise">Pro Intelligence</option>
        </select>
      </label>}
    </div>
    <p>{product === 'planner' ? 'Planner se configura como un producto independiente, sin versión de TransGest.' : 'La versión determina las funciones y la tarifa de TransGest.'}</p>
    {product === 'transgest' && <details open={modalidad === 'combinado'}>
      <summary>Planner adicional {modalidad === 'combinado' ? '· activo' : '· opcional'}</summary>
      <label className="sa-check-row"><input type="checkbox" checked={modalidad === 'combinado'} onChange={e=>changeExtra(e.target.checked)}/> Habilitar también Planner en esta empresa</label>
      <p>Es un acceso adicional. La versión de TransGest se elige arriba. Los accesos existentes se conservan hasta guardar un cambio.</p>
    </details>}
  </fieldset>;
}
