export const marginPercent = (cost, price) => Number(price) > 0
  ? Number(((Number(price) - Number(cost)) / Number(price) * 100).toFixed(2)) : '';

export function updateArticlePricing(article, field, value) {
  const next = { ...article, [field]: value };
  if (field === 'margen') {
    const margin = Number(value);
    if (value !== '' && Number.isFinite(margin) && margin < 100)
      next.precio_venta = (Number(article.coste) / (1 - margin / 100)).toFixed(4);
  } else if (field === 'coste' && article.margen !== undefined && article.margen !== '') {
    const margin = Number(article.margen);
    if (margin < 100) next.precio_venta = (Number(value) / (1 - margin / 100)).toFixed(4);
  } else if (field === 'precio_venta') next.margen = marginPercent(next.coste, value);
  return next;
}
