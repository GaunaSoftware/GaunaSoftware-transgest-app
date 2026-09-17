import {marginPercent,updateArticlePricing} from './pricing';

test('price and margin can be edited in either direction without using markup',()=>{
 let article=updateArticlePricing({coste:75,precio_venta:0},'margen','25');
 expect(Number(article.precio_venta)).toBe(100);
 article=updateArticlePricing(article,'coste','150');
 expect(Number(article.precio_venta)).toBe(200);
 article=updateArticlePricing(article,'precio_venta','180');
 expect(article.margen).toBe(16.67);
 expect(marginPercent(10,8)).toBe(-25);
 expect(marginPercent(10,0)).toBe('');
 expect(updateArticlePricing(article,'margen','100').precio_venta).toBe('180');
});
