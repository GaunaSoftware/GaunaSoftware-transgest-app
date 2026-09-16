export const AGENDA_TYPES={
 tarea:{label:'Tarea',color:'#2563eb',bg:'rgba(37,99,235,.10)'},
 reunion:{label:'Reunión',color:'#1686e8',bg:'rgba(22,134,232,.10)'},
 seguimiento:{label:'Seguimiento',color:'#2563eb',bg:'rgba(37,99,235,.10)'},
 llamada:{label:'Llamada',color:'#8650d8',bg:'rgba(134,80,216,.10)'},
 carga:{label:'Carga',color:'#009e80',bg:'rgba(0,158,128,.10)'},
 descarga:{label:'Descarga',color:'#ef8500',bg:'rgba(239,133,0,.10)'},
 recordatorio:{label:'Recordatorio',color:'#b98400',bg:'rgba(234,179,8,.12)'},
 vencimiento:{label:'Vencimiento',color:'#e33b60',bg:'rgba(227,59,96,.10)'},
 operativa:{label:'Operativa',color:'#009e80',bg:'rgba(0,158,128,.10)'},
};
export const agendaType=t=>AGENDA_TYPES[t]||AGENDA_TYPES.tarea;
export const agendaStyle=t=>({'--event-color':agendaType(t).color,'--event-bg':agendaType(t).bg});
