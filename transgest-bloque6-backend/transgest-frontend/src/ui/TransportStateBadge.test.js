import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TransportStateBadge } from './index';
import { TRANSPORT_STATES } from '../utils/transportStateCatalog';
import { renderToStaticMarkup } from 'react-dom/server.node';

test('operational states retain their label and explanation instead of a generic success badge', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<>{Object.keys(TRANSPORT_STATES).map(state => <TransportStateBadge key={state} state={state}/>)}</>));
    const badges = [...container.querySelectorAll('.tgui-badge')];
    expect(badges).toHaveLength(Object.keys(TRANSPORT_STATES).length);
    badges.forEach((badge, i) => {
      const state = Object.values(TRANSPORT_STATES)[i];
      expect(badge.textContent).toBe(state.label);
      expect(badge.title).toBe(state.description);
      // This repository's JSDOM drops CSS variables in color/background. Check
      // React's serialized style here; real computed colors are verified in browser.
      const html = renderToStaticMarkup(<TransportStateBadge state={Object.keys(TRANSPORT_STATES)[i]}/>);
      expect(html).toContain(state.textColor);
      expect(html).toContain(state.bg);
    });
  } finally { await act(async () => root.unmount()); }
});
