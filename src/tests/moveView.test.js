// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// Drives the Move to backup screen through a fake preload bridge.

let MoveView, DPRProvider;
const calls = [];
beforeAll(async () => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let copied = false;
  window.electronAPI = {
    moveCopy: async (opts) => { calls.push(['copy', opts]); copied = true; return { copied: [{ local: 'C:\\Phone\\IMG_2.HEIC', backup: 'Z:\\Photos\\2025\\07\\IMG_2.HEIC', size: 200 }], skipped: [], failed: [], bytes: 200 }; },
    moveFreeUpSummary: async () => ({ files: copied ? 2 : 1, bytes: copied ? 300 : 100 }),
    moveFreeUp: async () => { calls.push(['freeUp']); return { trashed: ['a', 'b'], quarantined: [], skipped: [], failed: [], freedBytes: 300 }; },
    moveCancel: async () => {},
    onMoveProgress: () => {}, removeMoveProgress: () => {},
  };
  ({ default: MoveView } = await import('../renderer/views/MoveView.jsx'));
  ({ DPRProvider } = await import('../renderer/contexts/DPRContext.jsx'));
});

const result = {
  totalScanned: 3,
  move: {
    newFiles: [{ path: 'C:\\Phone\\IMG_2.HEIC', root: 'C:\\Phone', size: 200, modified: '2025-07-14T10:00:00.000Z' }],
    inBackup: [{ file: { path: 'C:\\Phone\\IMG_1.HEIC', root: 'C:\\Phone', size: 100 }, backup: 'Z:\\Photos\\old\\IMG_1.HEIC' }],
    unreadable: [],
  },
};
const config = { job: 'move', protectedFolders: ['Z:\\Photos'], targetFolders: ['C:\\Phone'] };

async function render(onDone = () => {}) {
  const el = document.createElement('div');
  document.body.innerHTML = '';
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(React.createElement(DPRProvider, null, React.createElement(MoveView, { scanResult: result, scanConfig: config, onDone, onBack() {} })));
  });
  return el;
}
const button = (el, re) => Array.from(document.querySelectorAll('button')).find(b => re.test(b.textContent));
const click = (node) => act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('MoveView', () => {
  it('shows what is new, where it will go, and what is already backed up', async () => {
    const el = await render();
    expect(el.querySelector('[role="status"]').textContent).toMatch(/1 new file to copy/);
    expect(el.querySelector('[role="status"]').textContent).toMatch(/1 file is already in the backup/);
    expect(el.querySelector('tbody').textContent).toMatch(/Z:\\Photos\\2025\\07\\IMG_2\.HEIC/);
    await click(button(el, /^Same folders$/));
    expect(el.querySelector('tbody').textContent).toMatch(/Z:\\Photos\\Phone\\IMG_2\.HEIC/);
    await click(button(el, /^Already in the backup/));
    expect(el.querySelector('tbody').textContent).toMatch(/Z:\\Photos\\old\\IMG_1\.HEIC/);
  });

  it('copies with the chosen layout, then frees up space only after confirmation', async () => {
    calls.length = 0;
    let done = null;
    const el = await render((r) => { done = r; });
    await click(button(el, /^Copy 1 file to backup/));
    expect(calls[0]).toEqual(['copy', { layout: 'date' }]);
    expect(el.textContent).toMatch(/1 copied and verified/);
    expect(el.textContent).toMatch(/Free up 300\.0 B on this computer/);

    await click(button(el, /^Free up space…$/));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toMatch(/Remove 2 local files\?/);
    expect(calls.find(c => c[0] === 'freeUp')).toBeUndefined();   // nothing removed before confirming

    await click(button(el, /^Remove local copies$/));
    expect(calls.at(-1)).toEqual(['freeUp']);
    expect(done).toMatchObject({ trashed: ['a', 'b'], totalScanned: 3 });
  });
});
