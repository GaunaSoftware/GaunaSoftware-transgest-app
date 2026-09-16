import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Render outside the scrolling table so additional stops never get clipped.
export default function OrderQuickInfo({ label, text }) {
  const id = useId(), trigger = useRef(null), popup = useRef(null), timer = useRef(null);
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ top:0, left:0, width:320 });
  const cancelHide = () => window.clearTimeout(timer.current);
  const show = () => { cancelHide(); setOpen(true); };
  const hide = () => { cancelHide(); if (!pinned) timer.current = window.setTimeout(() => setOpen(false), 140); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 24);
      const height = popup.current?.getBoundingClientRect().height || 100;
      const top = rect.bottom + 8 + height <= window.innerHeight - 12 ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
      setPosition({ width, top, left:Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) });
    };
    const dismiss = () => { setOpen(false); setPinned(false); };
    const outside = event => { if (!trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) dismiss(); };
    const keyboard = event => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); } };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open, text]);
  return <>
    <button ref={trigger} type="button" className="orders-info-trigger" aria-describedby={open ? id : undefined} aria-expanded={open}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show}
      onBlur={() => { cancelHide(); setOpen(false); setPinned(false); }}
      onClick={event => { event.stopPropagation(); cancelHide(); setOpen(!pinned); setPinned(!pinned); }}>{label}</button>
    {open && createPortal(<div ref={popup} id={id} role="tooltip" className="orders-info-popup" style={position} onMouseEnter={cancelHide} onMouseLeave={hide}>{text}</div>, document.body)}
  </>;
}
