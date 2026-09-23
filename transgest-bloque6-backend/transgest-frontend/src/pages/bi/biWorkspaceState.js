export const initialBiState = {
  vista:'direccion', periodo:'mes', desde:'', hasta:'', cliente_id:'', ruta:'', vehiculo_id:'', ejecucion:'',
  granularity:'', page:1, limit:20, sort:'fecha', direction:'desc', invoicePage:1,invoiceSort:'fecha_vencimiento',invoiceDirection:'asc', matriz:'cliente', matrizPage:1,
  matrizSort:'margen_directo_registrado', matrizDirection:'desc',
  columnas:['nombre','ingreso','coste_directo_registrado','margen_directo_registrado','km_total','km_vacios'],
  columnasServicios:['numero','fecha','cliente','ruta','vehiculo','ejecucion','ingreso','coste','margen','km_pedido']
};
export const filterKeys = ['cliente_id','ruta','vehiculo_id','ejecucion'];
export function queryForBi(state) {
  const q = state.periodo === 'personalizado' ? {desde:state.desde,hasta:state.hasta} : {periodo:state.periodo};
  if (state.granularity) q.granularity = state.granularity;
  if (['operaciones','flota','calidad'].includes(state.vista)) q.vista=state.vista;
  for (const key of filterKeys) if (state[key]) q[key] = state[key];
  return {...q,page:state.page,limit:state.limit,sort:state.sort,direction:state.direction,invoice_page:state.invoicePage,invoice_sort:state.invoiceSort,invoice_direction:state.invoiceDirection};
}
export function changeBiFilter(state, key, value) {
  if (!filterKeys.includes(key)) return state;
  return {...state,[key]:value,page:1,invoicePage:1,matrizPage:1};
}
export function clearBiFilters(state) {
  return {...state,periodo:'mes',desde:'',hasta:'',cliente_id:'',ruta:'',vehiculo_id:'',ejecucion:'',granularity:'',page:1,invoicePage:1,matrizPage:1};
}
export function restoreBiState(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return initialBiState;
    const safe = {...initialBiState};
    for (const key of Object.keys(safe)) if (Object.prototype.hasOwnProperty.call(value,key)) safe[key] = value[key];
    if (!['direccion','rentabilidad','operaciones','flota','calidad','centro','anteriores'].includes(safe.vista)) safe.vista='direccion';
    if (!Array.isArray(safe.columnas)) safe.columnas=initialBiState.columnas;
    if (!Array.isArray(safe.columnasServicios)) safe.columnasServicios=initialBiState.columnasServicios;
    return safe;
  } catch { return initialBiState; }
}
