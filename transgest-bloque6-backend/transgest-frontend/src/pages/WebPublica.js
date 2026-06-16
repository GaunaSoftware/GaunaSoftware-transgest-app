import React, { useState } from "react";

const heroImg = "https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=2200&q=80";
const trafficImg = "https://images.unsplash.com/photo-1494412651409-8963ce7935a7?auto=format&fit=crop&w=1400&q=80";
const workshopImg = "https://images.unsplash.com/photo-1487754180451-c456f719a1fc?auto=format&fit=crop&w=1400&q=80";
const officeImg = "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1400&q=80";

const plans = [
  {
    name: "Basico",
    price: "99 EUR/mes",
    text: "Operativa completa para trafico, flota, clientes, rutas, facturacion y taller.",
    items: ["Vehiculos ilimitados", "Usuarios ilimitados", "Pedidos y cuadrantes", "Facturacion operativa"],
  },
  {
    name: "Profesional",
    price: "199 EUR/mes",
    text: "Control de gestion con KPIs, objetivos y seguimiento economico de la empresa.",
    items: ["Todo Basico", "KPIs de gestion", "Objetivos y tarifas", "Informes avanzados"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "399 EUR/mes",
    text: "Inteligencia artificial, acompanamiento y configuracion avanzada para equipos exigentes.",
    items: ["Todo Profesional", "IA incluida", "Soporte prioritario", "Configuracion avanzada"],
  },
];

const modules = [
  ["Trafico", "Pedidos, cargas, descargas, cuadrantes y rutas listas para trabajar sin duplicar datos."],
  ["Flota", "Camiones, conjuntos, choferes, documentacion, ubicaciones y taller siempre bajo control."],
  ["Gestion", "Margenes, gastos, objetivos, KPIs y facturas para tomar decisiones con numeros claros."],
  ["Integraciones", "Preparado para conectar GPS, importar datos y trabajar con la informacion de tu empresa."],
];

const ACCESS_URLS = {
  empresa: process.env.REACT_APP_EMPRESA_ACCESS_URL || "",
  asociados: process.env.REACT_APP_ASOCIADOS_ACCESS_URL || "",
};

function safeRedirect(url) {
  if (!url) return false;
  try {
    const next = new URL(url, window.location.origin);
    if (!["http:", "https:"].includes(next.protocol)) return false;
    window.location.assign(next.href);
    return true;
  } catch {
    return false;
  }
}

export default function WebPublica() {
  const [access, setAccess] = useState(null);
  const openAccess = type => {
    if (!safeRedirect(ACCESS_URLS[type])) setAccess(type);
  };

  return (
    <div className="tg-web" style={S.page}>
      <style>{`
        .tg-web { --web-h1: 68px; --web-h2: 46px; --web-contact: 50px; }
        @media (max-width: 760px) {
          .tg-web { --web-h1: 40px; --web-h2: 31px; --web-contact: 34px; }
          .tg-web-nav { position: static !important; height: auto !important; align-items: flex-start !important; }
          .tg-web-links { width: 100%; gap: 10px !important; }
          .tg-web-link { font-size: 13px !important; }
        }
      `}</style>
      <header className="tg-web-nav" style={S.nav}>
        <button type="button" onClick={() => window.location.hash = ""} style={S.brand}>TransGest</button>
        <nav className="tg-web-links" style={S.links}>
          <a className="tg-web-link" style={S.link} href="#producto">Producto</a>
          <a className="tg-web-link" style={S.link} href="#planes">Planes</a>
          <a className="tg-web-link" style={S.link} href="#contacto">Contacto</a>
          <button type="button" style={S.login} onClick={() => openAccess("empresa")}>Acceso empresas</button>
          <button type="button" style={S.loginAlt} onClick={() => openAccess("asociados")}>Acceso asociados</button>
        </nav>
      </header>

      <section style={{...S.hero, backgroundImage:`linear-gradient(90deg, rgba(14,22,18,.88), rgba(14,22,18,.42)), url(${heroImg})`}}>
        <div style={S.heroText}>
          <div style={S.kicker}>Software de gestion para transporte</div>
          <h1 style={S.h1}>Trafico, taller, flota y facturacion en el mismo sitio.</h1>
          <p style={S.heroP}>
            TransGest ordena el dia a dia de una empresa de transporte: pedidos, camiones, choferes, rutas, gastos, KPIs, taller y facturacion.
          </p>
          <div style={S.actions}>
            <a style={S.primary} href="#contacto">Solicitar demo</a>
            <button type="button" style={S.secondary} onClick={() => setAccess("selector")}>Acceso privado</button>
          </div>
        </div>
      </section>

      <section style={S.metricBand}>
        {[
          ["Una gestion", "trafico, flota, taller y facturacion"],
          ["GPS ready", "preparado para integraciones"],
          ["Datos claros", "costes, margenes y KPIs"],
          ["Sin limites", "vehiculos y usuarios"],
        ].map(([n,t]) => (
          <div key={t} style={S.metric}>
            <strong>{n}</strong>
            <span>{t}</span>
          </div>
        ))}
      </section>

      <main>
        <section id="producto" style={S.section}>
          <div style={S.sectionHead}>
            <span style={S.kickerDark}>Producto</span>
            <h2 style={S.h2}>Menos hojas sueltas. Mas control real.</h2>
            <p style={S.lead}>Cada pedido alimenta el cuadrante, la flota, los costes, la facturacion y los informes.</p>
          </div>
          <div style={S.split}>
            <img style={S.image} src={trafficImg} alt="Camiones circulando por una autopista" />
            <div style={S.moduleGrid}>
              {modules.map(([title,text]) => (
                <article key={title} style={S.module}>
                  <h3 style={S.h3}>{title}</h3>
                  <p style={S.p}>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section style={S.altSection}>
          <div style={S.twoCol}>
            <div>
              <span style={S.kickerDark}>Taller y flota</span>
              <h2 style={S.h2}>Vehiculos ilimitados, mantenimiento claro.</h2>
              <p style={S.lead}>
                Controla documentacion, reparaciones, solicitudes del chofer y ubicaciones operativas con una base preparada para conectar GPS.
              </p>
              <ul style={S.list}>
                <li>Camiones, remolques y conjuntos sin tope.</li>
                <li>Avisos de documentacion, taller y revisiones.</li>
                <li>Asignacion de chofer y vehiculo desde el pedido rapido.</li>
                <li>Ubicacion actualizable desde GPS cuando la integracion este conectada.</li>
              </ul>
            </div>
            <img style={S.imageTall} src={workshopImg} alt="Mecanico trabajando en un vehiculo industrial" />
          </div>
        </section>

        <section id="planes" style={S.section}>
          <div style={S.sectionHead}>
            <span style={S.kickerDark}>Planes</span>
            <h2 style={S.h2}>Crece sin contar vehiculos.</h2>
            <p style={S.lead}>El plan cambia por capacidad de gestion, KPIs e IA. No por limitar la flota.</p>
          </div>
          <div style={S.plans}>
            {plans.map(plan => (
              <article key={plan.name} style={{...S.plan, ...(plan.featured ? S.planFeatured : {})}}>
                <div style={S.planTop}>
                  <h3 style={S.planName}>{plan.name}</h3>
                  {plan.featured && <span style={S.badge}>Recomendado</span>}
                </div>
                <div style={S.price}>{plan.price}</div>
                <p style={S.p}>{plan.text}</p>
                <ul style={S.planList}>
                  {plan.items.map(item => <li key={item}>{item}</li>)}
                </ul>
              </article>
            ))}
          </div>
          <div style={S.discount}>Facturacion anual con 15% de descuento.</div>
        </section>

        <section style={S.altSection}>
          <div style={S.twoColReverse}>
            <img style={S.imageTall} src={officeImg} alt="Equipo revisando facturas y datos de gestion" />
            <div>
              <span style={S.kickerDark}>Empresa conectada</span>
              <h2 style={S.h2}>Toda la informacion trabajando junta.</h2>
              <p style={S.lead}>
                Trafico, flota, clientes, facturacion, taller, documentos e informes comparten los mismos datos para que el equipo trabaje con una unica version de la realidad.
              </p>
              <ul style={S.list}>
                <li>Pedidos conectados con cuadrantes, gastos e informes.</li>
                <li>Clientes, rutas y tarifas reutilizables en cada operacion.</li>
                <li>Importaciones para arrancar con datos ya existentes.</li>
                <li>Base lista para conectar GPS, automatizaciones y nuevas integraciones.</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="contacto" style={S.contact}>
          <div>
            <span style={S.kickerLight}>Contacto</span>
            <h2 style={S.contactTitle}>Prepara tu demo de TransGest.</h2>
            <p style={S.contactText}>Cuentanos tu flota, tus rutas y como trabajas hoy. Te ayudamos a dejarlo funcionando.</p>
          </div>
          <form style={S.form} onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const subject = encodeURIComponent("Demo TransGest");
            const body = encodeURIComponent(`Nombre: ${data.get("nombre")}\nEmpresa: ${data.get("empresa")}\nTelefono: ${data.get("telefono")}\nMensaje: ${data.get("mensaje")}`);
            window.location.href = `mailto:info@transgest.es?subject=${subject}&body=${body}`;
          }}>
            <input style={S.input} name="nombre" placeholder="Nombre" required />
            <input style={S.input} name="empresa" placeholder="Empresa" required />
            <input style={S.input} name="telefono" placeholder="Telefono" />
            <textarea style={S.textarea} name="mensaje" placeholder="Que necesitas controlar mejor" rows={4} />
            <button style={S.submit}>Solicitar demo</button>
          </form>
        </section>
      </main>
      {access && (
        <div style={S.modalOverlay} onClick={e => e.target === e.currentTarget && setAccess(null)}>
          <div style={S.modal} role="dialog" aria-modal="true" aria-labelledby="access-title">
            <button type="button" aria-label="Cerrar" onClick={() => setAccess(null)} style={S.modalClose}>×</button>
            <span style={S.kickerDark}>Acceso privado</span>
            <h2 id="access-title" style={S.modalTitle}>Elige tu entrada a TransGest.</h2>
            <p style={S.modalText}>
              El acceso privado se activara cuando la aplicacion este publicada en el servidor definitivo. Mientras tanto, estos botones no abren rutas internas que puedan devolver error.
            </p>
            <div style={S.accessGrid}>
              <button type="button" style={S.accessCard} onClick={() => openAccess("empresa")}>
                <strong>Empresa</strong>
                <span>Gerencia, trafico, facturacion, taller y usuarios internos.</span>
              </button>
              <button type="button" style={S.accessCard} onClick={() => openAccess("asociados")}>
                <strong>Asociados</strong>
                <span>Colaboradores, choferes externos y accesos operativos autorizados.</span>
              </button>
            </div>
            <a style={S.modalContact} href="#contacto" onClick={() => setAccess(null)}>Solicitar activacion</a>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  page: { minHeight:"100vh", background:"#f8faf8", color:"#17211d", fontFamily:"Inter, 'DM Sans', Arial, sans-serif" },
  nav: { position:"fixed", top:0, left:0, right:0, zIndex:10, height:66, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 clamp(18px,4vw,58px)", background:"rgba(248,250,248,.92)", borderBottom:"1px solid rgba(23,33,29,.12)", backdropFilter:"blur(12px)" },
  brand: { border:0, background:"transparent", fontSize:24, fontWeight:900, color:"#0f5f55", cursor:"pointer", letterSpacing:0 },
  links: { display:"flex", alignItems:"center", gap:18, flexWrap:"wrap" },
  link: { color:"#2e4039", textDecoration:"none", fontSize:14, fontWeight:700 },
  login: { border:"1px solid #0f5f55", background:"#fff", color:"#0f5f55", borderRadius:8, padding:"9px 16px", fontWeight:800, cursor:"pointer" },
  loginAlt: { border:"1px solid #d0a518", background:"#f4c430", color:"#17211d", borderRadius:8, padding:"9px 16px", fontWeight:900, cursor:"pointer" },
  hero: { minHeight:"84vh", display:"flex", alignItems:"center", backgroundSize:"cover", backgroundPosition:"center", padding:"96px clamp(20px,6vw,86px) 70px" },
  heroText: { maxWidth:760, color:"#fff" },
  kicker: { display:"inline-flex", padding:"7px 11px", border:"1px solid rgba(255,255,255,.42)", borderRadius:8, fontSize:13, fontWeight:800, marginBottom:18, background:"rgba(255,255,255,.12)" },
  kickerDark: { display:"inline-flex", color:"#0f766e", fontWeight:900, fontSize:13, textTransform:"uppercase", letterSpacing:0, marginBottom:10 },
  kickerLight: { display:"inline-flex", color:"#a7f3d0", fontWeight:900, fontSize:13, textTransform:"uppercase", letterSpacing:0, marginBottom:10 },
  h1: { fontSize:"var(--web-h1)", lineHeight:".98", margin:"0 0 18px", letterSpacing:0, maxWidth:920, overflowWrap:"break-word" },
  h2: { fontSize:"var(--web-h2)", lineHeight:1.02, margin:"0 0 14px", letterSpacing:0, color:"#17211d", overflowWrap:"break-word" },
  h3: { fontSize:21, margin:"0 0 8px", color:"#17211d" },
  heroP: { fontSize:20, lineHeight:1.45, maxWidth:680, margin:"0 0 28px", color:"#eefcf6" },
  actions: { display:"flex", gap:12, flexWrap:"wrap" },
  primary: { display:"inline-flex", textDecoration:"none", alignItems:"center", justifyContent:"center", minHeight:46, padding:"0 20px", borderRadius:8, background:"#f4c430", color:"#17211d", fontWeight:900, border:"1px solid #f4c430" },
  secondary: { minHeight:46, padding:"0 20px", borderRadius:8, background:"rgba(255,255,255,.14)", color:"#fff", border:"1px solid rgba(255,255,255,.48)", fontWeight:900, cursor:"pointer" },
  metricBand: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap:1, background:"#dce8e1", padding:"1px clamp(20px,6vw,86px)" },
  metric: { background:"#fff", padding:"20px", display:"flex", flexDirection:"column", gap:4, minHeight:82, justifyContent:"center" },
  section: { padding:"84px clamp(20px,6vw,86px)" },
  altSection: { padding:"84px clamp(20px,6vw,86px)", background:"#eef7f2" },
  sectionHead: { maxWidth:780, marginBottom:34 },
  lead: { fontSize:19, lineHeight:1.55, color:"#42564d", margin:"0 0 24px" },
  p: { color:"#42564d", lineHeight:1.5, margin:"0 0 14px", fontSize:15 },
  split: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap:28, alignItems:"stretch" },
  image: { width:"100%", minHeight:430, height:"100%", objectFit:"cover", borderRadius:8 },
  imageTall: { width:"100%", minHeight:420, height:"100%", objectFit:"cover", borderRadius:8 },
  moduleGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap:14 },
  module: { background:"#fff", border:"1px solid #d6e5dd", borderRadius:8, padding:20 },
  twoCol: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap:34, alignItems:"center" },
  twoColReverse: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap:34, alignItems:"center" },
  list: { margin:"18px 0 0", padding:"0 0 0 18px", color:"#25382f", lineHeight:1.8, fontWeight:700 },
  plans: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap:16 },
  plan: { background:"#fff", border:"1px solid #d6e5dd", borderRadius:8, padding:24, display:"flex", flexDirection:"column", minHeight:350 },
  planFeatured: { border:"2px solid #0f766e", boxShadow:"0 18px 35px rgba(15,118,110,.16)" },
  planTop: { display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:12 },
  planName: { margin:0, fontSize:24, color:"#17211d" },
  badge: { background:"#0f766e", color:"#fff", borderRadius:8, padding:"4px 8px", fontSize:12, fontWeight:900 },
  price: { fontSize:30, fontWeight:900, color:"#0f5f55", marginBottom:12 },
  planList: { margin:"auto 0 0", padding:"16px 0 0 18px", color:"#25382f", lineHeight:1.8, fontWeight:700 },
  discount: { marginTop:18, padding:"16px 18px", borderRadius:8, background:"#17211d", color:"#fff", fontWeight:900, display:"inline-flex" },
  contact: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap:34, alignItems:"start", padding:"88px clamp(20px,6vw,86px)", background:"#163c36", color:"#fff" },
  contactTitle: { fontSize:"var(--web-contact)", lineHeight:1, margin:"0 0 14px", letterSpacing:0, overflowWrap:"break-word" },
  contactText: { color:"#dff8ed", fontSize:19, lineHeight:1.55, margin:0 },
  form: { display:"grid", gap:10, background:"#f8faf8", borderRadius:8, padding:18 },
  input: { width:"100%", boxSizing:"border-box", border:"1px solid #c9ddd3", borderRadius:8, padding:"13px 14px", fontSize:15, color:"#17211d", outline:"none" },
  textarea: { width:"100%", boxSizing:"border-box", border:"1px solid #c9ddd3", borderRadius:8, padding:"13px 14px", fontSize:15, color:"#17211d", outline:"none", resize:"vertical", fontFamily:"inherit" },
  submit: { border:0, borderRadius:8, minHeight:48, background:"#f4c430", color:"#17211d", fontWeight:900, cursor:"pointer" },
  modalOverlay: { position:"fixed", inset:0, zIndex:50, background:"rgba(13,24,20,.72)", display:"flex", alignItems:"center", justifyContent:"center", padding:18 },
  modal: { position:"relative", width:"min(620px, 100%)", background:"#fff", border:"1px solid #d6e5dd", borderRadius:8, padding:24, boxShadow:"0 24px 80px rgba(0,0,0,.28)" },
  modalClose: { position:"absolute", top:10, right:10, width:34, height:34, border:"1px solid #d6e5dd", borderRadius:8, background:"#fff", color:"#17211d", fontSize:22, lineHeight:1, cursor:"pointer" },
  modalTitle: { fontSize:34, lineHeight:1.05, margin:"0 34px 12px 0", color:"#17211d", letterSpacing:0 },
  modalText: { color:"#42564d", lineHeight:1.55, margin:"0 0 16px", fontSize:16 },
  accessGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap:12, marginBottom:16 },
  accessCard: { textAlign:"left", border:"1px solid #c9ddd3", background:"#f8faf8", color:"#17211d", borderRadius:8, padding:16, cursor:"pointer", display:"flex", flexDirection:"column", gap:8, fontFamily:"inherit" },
  modalContact: { display:"inline-flex", alignItems:"center", justifyContent:"center", minHeight:42, padding:"0 16px", borderRadius:8, background:"#0f5f55", color:"#fff", textDecoration:"none", fontWeight:900 },
};
