import { useEffect, useId, useMemo, useState } from "react";

const inputStyle = { width:"100%", minWidth:0, boxSizing:"border-box", padding:"10px 12px", borderRadius:6, border:"1px solid var(--border2)", background:"var(--bg4,#fff)", color:"var(--text)", fontSize:13 };
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function ResourcePicker({ label, value, options, onChange, freeText=false, open, onOpen, onClose, availability=false }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [active, setActive] = useState(0);
  const selected = options.find(option => String(option.value) === String(value));
  const results = useMemo(() => options.filter(option =>
    normalize(option.label).includes(normalize(query)) &&
    (filter === "all" || (filter === "free" ? option.available === true : option.available === false))
  ).sort((a,b) => Number(b.available === true)-Number(a.available === true) || a.label.localeCompare(b.label)), [options,query,filter]);
  const choose = option => { onChange(option.value); onClose(); setQuery(""); };
  useEffect(()=>{ if(open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({block:"nearest"}); },[id,active,open]);
  return <div style={{minWidth:0}} onBlur={event=>{if (!event.currentTarget.contains(event.relatedTarget)) onClose();}}>
    <label htmlFor={id} style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"var(--text)"}}>{label}</label>
    <div style={{display:"flex",flexWrap:"nowrap",gap:5}}>
      <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && results.length ? `${id}-option-${Math.min(active,results.length-1)}` : undefined}
        style={{...inputStyle,flex:1}} value={open ? query : selected?.label || value || ""} placeholder={label}
        onFocus={()=>{setQuery("");setActive(0);onOpen();}}
        onChange={event=>{setQuery(event.target.value);setActive(0);if (freeText) onChange(event.target.value);}}
        onKeyDown={event=>{
          if (event.key === "Escape") { onClose(); return; }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); onOpen(); setActive(index=>Math.max(0,Math.min(results.length-1,index+(event.key==="ArrowDown"?1:-1))));
          }
          if (event.key === "Enter" && open && results.length) {event.preventDefault();choose(results[Math.min(active,results.length-1)]);}
        }} />
      <button type="button" aria-label={`Quitar ${label}`} title={`Quitar ${label}`} onClick={()=>{onChange("");setQuery("");}} style={{...inputStyle,width:36,padding:0,flexShrink:0}}>{"\u00d7"}</button>
    </div>
    {open && <div style={{border:"1px solid var(--border2)",borderRadius:6,marginTop:4,background:"var(--bg2)",overflow:"hidden"}}>
      <div style={{display:"flex",flexWrap:"nowrap",justifyContent:"space-between",alignItems:"center",gap:8,padding:7,fontSize:11,color:"var(--text4)"}}>
        <span>{results.length} resultados</span>
        {availability && <select aria-label={`Disponibilidad ${label}`} value={filter} onChange={event=>{setFilter(event.target.value);setActive(0);}} style={{...inputStyle,width:"auto",padding:4,fontSize:11}}>
          <option value="all">Todos</option><option value="free">Disponibles</option><option value="busy">Ocupados</option>
        </select>}
      </div>
      <div id={`${id}-list`} role="listbox" aria-label={label} style={{maxHeight:210,overflowY:"auto",overscrollBehavior:"contain"}}>
        {results.map((option,index)=><div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={String(option.value)===String(value)}
          onMouseDown={event=>event.preventDefault()} onClick={()=>choose(option)}
          style={{padding:"8px 10px",cursor:"pointer",borderTop:"1px solid var(--border)",background:active===index?"var(--accent-a10)":"transparent",fontSize:12,color:"var(--text)",overflowWrap:"anywhere"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{option.label}</strong>
            {availability && <span style={{color:option.available===true?"var(--green,#15803d)":option.available===false?"var(--orange,#b45309)":"var(--text4)",whiteSpace:"nowrap",fontSize:11}}>{option.available===true?"Disponible":option.available===false?"Ocupado":"Sin verificar"}</span>}
          </div>
          {option.available===false && option.reason && <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>{option.reason}</div>}
        </div>)}
        {!results.length && <div style={{padding:10,fontSize:12,color:"var(--text4)"}}>Sin coincidencias</div>}
      </div>
    </div>}
  </div>;
}
