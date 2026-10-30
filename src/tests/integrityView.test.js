// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

let IntegrityView, DPRProvider;
beforeAll(async () => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.electronAPI = {
    archiveVerify: async (root) => ({
      root, recordedAt: '2026-01-01T00:00:00.000Z', recordedFiles: 4, ok: 2,
      corrupted: [{ p: '2024/02/b.jpg', s: 5, m: '2024-02-01T00:00:00.000Z' }], modified: [], missing: [{ p: '2024/03/c.jpg', s: 3, m: '2024-03-01T00:00:00.000Z' }],
      added: [], unreadable: [], counts: { corrupted: 1, modified: 0, missing: 1, added: 0, unreadable: 0 },
    }),
    archiveCancel: async () => {}, onArchiveProgress: () => {}, removeArchiveProgress: () => {},
  };
  ({ default: IntegrityView } = await import('../renderer/views/IntegrityView.jsx'));
  ({ DPRProvider } = await import('../renderer/contexts/DPRContext.jsx'));
});

describe('IntegrityView', () => {
  it('leads with damage, then lists the damaged files first', async () => {
    const el = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(el);
    await act(async () => {
      createRoot(el).render(React.createElement(DPRProvider, null, React.createElement(IntegrityView, { root: 'D:\\Offline', onBack() {} })));
    });
    await act(async () => { await Promise.resolve(); });
    expect(el.querySelector('[role="status"]').textContent).toMatch(/1 damaged and 1 missing files/);
    expect(el.querySelector('[aria-pressed="true"]').textContent).toMatch(/^Damaged \(1\)/);
    expect(el.querySelector('tbody').textContent).toMatch(/2024\/02\/b\.jpg/);
  });
});
