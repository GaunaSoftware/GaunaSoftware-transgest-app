# Refinamiento de Finanzas · referencias de 11/09/2026

## Alcance de esta entrega

Se aplican las tres referencias de Facturación al módulo ya migrado. El documento general adjunto se conserva como guía para fases posteriores. La indicación directa del usuario prevalece: no rediseñar todavía la barra lateral. Solo se sustituye el perfil inferior por Soporte y Cerrar sesión, manteniendo una única identidad en la cabecera.

## Inventario y dependencias revisadas

| Área del documento | Entradas actuales en `transgest-frontend/src` | Dependencias o alcance |
| --- | --- | --- |
| Estructura y componentes | `components/Layout.js`, `ui/index.js`, `ui/transgest-ui.css` | AuthContext, ThemeContext, branding, companyPalette; menús y pestañas existentes |
| Finanzas | `pages/Facturacion.js`, `pages/finance/InvoiceList.js`, `pages/finance/TreasuryView.js` | services/api, runtimeFocus, useEmpresaPerfil, planFeatures, ContabilidadExportPanel, Recharts |
| Soporte | `pages/MiCuenta.js` | Formulario y endpoint `/mi-cuenta/soporte` existentes; acceso sujeto a Mi cuenta visible |
| Trabajo diario | `pages/Dashboard.js`, `Agenda.js`, `Pedidos.js`, `GestionTrafico.js`, `ControlTower.js`, `Solicitudes.js`, `CalculadorPortes.js` | Inventariados; migración posterior. Dashboard y Agenda mantienen API y permisos propios |
| Comercial | `pages/Clientes.js`, `Colaboradores.js` | Inventariados; fichas y editores se revisarán con sus pantallas |
| Flota y almacén | `pages/Vehiculos.js`, `Choferes.js`, `Taller.js`, `Palets.js` | Inventariados; sin cambios en esta entrega |
| Administración | `pages/Nominas.js`, `HojasRuta.js`, `Informes.js`, `Empresa.js`, `Usuarios.js`, `ControlHorario.js`, `Intelligence.js` | Inventariados; sin cambios en esta entrega |
| Experiencias externas | `pages/PortalClientes.js`, `AppChofer.js` | Se mantienen independientes. Portal usa AuthContext, useEmpresaPerfil y PortalPointPicker |

Este inventario identifica entradas y dependencias compartidas; no implica que se hayan auditado o rediseñado todos los módulos.

## Cambios

- Indicadores con iconos, títulos legibles, cifras tabulares y cuatro tarjetas contextualizadas por pestaña. Cobros conserva sus cuatro métricas de control en una sola fila.
- Se retira la segunda tarjeta del saldo previsto a 30 días del cuerpo de Tesorería. El saldo actual y la curva de previsión permanecen.
- Tres avisos compactos y navegables: documentación, seguimiento de cobros y estado fiscal. Sin datos o tendencias inventados.
- Viajes pendientes antes del panel de facturas. Revisar viajes abre el mismo drawer; Facturar pedidos permanece dentro. Nueva factura aparece una vez y se fija abajo en móvil.
- Panel de facturas con título, filtros, agrupación y exportación existente. Filas de aproximadamente 56 px según sus controles; tarjetas para anchuras inferiores a 768 px.
- Móvil <768 px, tablet 768–1023 px; escritorio compacto con indicadores en dos columnas. El breakpoint lateral original de 1024 px no cambia.
- Soporte utiliza runtimeFocus para abrir la pestaña existente de Mi cuenta, tanto desde otra pantalla como desde Mi cuenta ya montada. Abrir el formulario no envía mensajes.
- Cerrar sesión reutiliza `logout`, sin inventar una operación de cierre de ventana Electron. Los dos accesos inferiores conservan etiquetas accesibles y controles de al menos 44 px en modo expandido, colapsado y móvil.

Se mantienen la paleta de empresa y los modos claro/oscuro. No se modifican endpoints, payloads, cálculos financieros, permisos, modelos ni dependencias. Los archivos ajenos que ya estaban modificados se excluyen de los commits de esta entrega.

## Validación

Se amplía `scripts/finance_browser_check.cjs` con tamaños 1600×900, 1366×768, 1024×768, 768×1024, 430×932 y 390×844, además del borde de 767 px y otras anchuras. Revisa ambos temas, navegación, formularios, permisos de solo lectura, paleta personalizada, indicadores sin duplicación, Soporte y cierre de sesión sobre API simulada.

Las comprobaciones de preservación AST cubren 37 cálculos, funciones de carga y handlers financieros existentes. La validación visual en navegador no sustituye la ejecución de los binarios Electron o de las aplicaciones Android/iOS.

Resultado: `npm run check` y `npm run build` correctos; 121 comprobaciones de navegador y 37 de preservación superadas. Sin errores de consola. La compilación mantiene los dos avisos previos de dependencias de hooks en GestionTrafico y MiCuenta, sin avisos nuevos. Las tres escrituras del test fueron simuladas (inicialización y cambio de estado de factura); no se envió ningún mensaje de soporte.
