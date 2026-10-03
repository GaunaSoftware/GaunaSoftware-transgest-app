export function orderFocusFilters(focus = {}) {
  focus = focus || {};
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : '';
  return {
    from: validDate(focus.desde),
    to: validDate(focus.hasta),
    ids: Array.isArray(focus.pedido_ids) ? focus.pedido_ids : null,
    title: focus.title || '',
  };
}
