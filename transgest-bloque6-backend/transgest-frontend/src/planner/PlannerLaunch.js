import { useEffect, useState } from 'react';
import plannerLogo from '../assets/brand/transgest_planner_white.svg';

export function PlannerBrand({ className = '' }) {
  return <img className={`planner-brand ${className}`} src={plannerLogo} alt="TransGest Planner" />;
}

export default function PlannerLaunch() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fade = setTimeout(() => setLeaving(true), motion.matches ? 100 : 1800);
    const finish = setTimeout(() => setVisible(false), motion.matches ? 150 : 2250);
    const dismiss = event => { if (event.key === 'Escape') setVisible(false); };
    window.addEventListener('keydown', dismiss);
    return () => { clearTimeout(fade); clearTimeout(finish); window.removeEventListener('keydown', dismiss); };
  }, []);
  if (!visible) return null;
  return <div className={`planner-launch${leaving ? ' planner-launch-leaving' : ''}`} aria-hidden="true">
    <div className="planner-launch-content">
      <PlannerBrand />
      <p>Tu almacén. Tus cargas. Todo conectado.</p>
      <div className="planner-launch-track"><span /></div>
    </div>
  </div>;
}
