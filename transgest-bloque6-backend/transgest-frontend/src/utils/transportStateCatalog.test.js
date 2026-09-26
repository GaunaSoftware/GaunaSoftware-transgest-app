import { TRANSPORT_STATES, RECOMMENDED_STATE_FLOW, transportStateMeta } from './transportStateCatalog';
import fs from 'fs';
import path from 'path';

test('shared transport states keep incident and execution separate', () => {
  for (const key of ['pendiente','confirmado','espera_carga','cargando','en_curso','espera_descarga','descarga','entregado','incidencia','cancelado']) {
    expect(transportStateMeta(key).label).toBeTruthy();
    expect(transportStateMeta(key).color).toMatch(/^#[0-9a-f]{6}$/i);
  }
  expect(TRANSPORT_STATES.incidencia.incident).toBe(true);
  expect(TRANSPORT_STATES.entregado.final).toBe(true);
  expect(TRANSPORT_STATES.en_curso.final).toBe(false);
  expect(TRANSPORT_STATES.colaborador).toBeUndefined();
  expect(RECOMMENDED_STATE_FLOW.cargando).toBe('en_curso');
  expect(transportStateMeta('estado_legacy').description).toBe('Estado no catalogado');
});

test('every transport badge has readable text in both themes (at least 4.5:1)', () => {
  const css = fs.readFileSync(path.join(__dirname, 'transportStates.css'), 'utf8');
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const themes = [...css.matchAll(/:root[^\{]*\{([^}]+)\}/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/--transport-([\w]+)-(text|bg):\s*(#[\da-f]{6})/g)].map(m => [`${m[1]}-${m[2]}`, m[3]])
  ));
  expect(themes).toHaveLength(2);
  for (const tokens of themes) for (const state of Object.keys(TRANSPORT_STATES)) {
    const text = luminance(tokens[`${state}-text`]), bg = luminance(tokens[`${state}-bg`]);
    expect((Math.max(text, bg) + .05) / (Math.min(text, bg) + .05)).toBeGreaterThanOrEqual(4.5);
  }
});
