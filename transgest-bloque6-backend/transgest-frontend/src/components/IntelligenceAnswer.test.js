import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import IntelligenceAnswer from './IntelligenceAnswer';

test('formats report sections and tables while escaping untrusted company or model text', () => {
  const html=renderToStaticMarkup(<IntelligenceAnswer content={'## Pedidos pendientes\n**2 pedidos**\n\n| Pedido | Cliente |\n| --- | --- |\n| PED-1 | <img src=x onerror=alert(1)> |\n\n- Revisar la entrega\n1. Confirmar horario'}/>);
  expect(html).toContain('<h3>Pedidos pendientes</h3>');
  expect(html).toContain('<strong>2 pedidos</strong>');
  expect(html).toContain('<table>'); expect(html).toContain('<ul>'); expect(html).toContain('<ol>');
  expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
});
