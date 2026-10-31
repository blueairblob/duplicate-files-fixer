// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import CompareView from '../renderer/views/CompareView.jsx';
import { DPRProvider } from '../renderer/contexts/DPRContext.jsx';

// The Compare screen: bar and boxes pick the list, the list explains itself,
// sorts by column, and only the Review button leaves the page.

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const f = (path, size, sourceLabel = 'target') => ({ path, name: path.split('/').pop(), size, modified: '2026-01-01T00:00:00.000Z', ext: '.jpg', sourceLabel });

function result(confidence = 'standard') {
  const groups = [
    { id: 0, hash: 'h0', hasProtected: true, autoMarked: ['/t/A/a.jpg'], files: [f('/s/a.jpg', 100, 'protected'), f('/t/A/a.jpg', 100)] },
    { id: 1, hash: 'h1', hasProtected: true, autoMarked: ['/t/A/big.jpg'], files: [f('/s/big.jpg', 900, 'protected'), f('/t/A/big.jpg', 900)] },
  ];
  const census = {
    roots: { source: { paths: ['/s'], files: 3, bytes: 1050 }, target: { paths: ['/t'], files: 3, bytes: 1070 } },
    matched: { targetFiles: 2, sourceFiles: 2, bytes: 1000 },
    sourceOnly: { files: 1, bytes: 50, list: [{ path: '/s/only-src.jpg', size: 50, modified: '2026-01-01T00:00:00.000Z' }] },
    targetOnly: { files: 1, bytes: 70, list: [{ path: '/t/B/only-tgt.jpg', size: 70, modified: '2026-01-01T00:00:00.000Z' }] },
    unreadable: { sourceFiles: 0, targetFiles: 0, list: [] },
    folders: [
      { key: '/t\u0000A', path: 'A', root: '/t', files: 2, matched: 2, targetOnly: 0, unreadable: 0, bytes: 1000, reclaimable: 1000, matchedPaths: ['/t/A/a.jpg', '/t/A/big.jpg'], truncated: false, state: 'all' },
      { key: '/t\u0000B', path: 'B', root: '/t', files: 1, matched: 0, targetOnly: 1, unreadable: 0, bytes: 70, reclaimable: 0, matchedPaths: [], truncated: false, state: 'none' },
    ],
  };
  return { groups, census, confidence, totalScanned: 6, mode: 'compare' };
}

function render(props) {
  const el = document.createElement('div');
  document.body.innerHTML = '';
  document.body.appendChild(el);
  const calls = [];
  act(() => {
    createRoot(el).render(React.createElement(DPRProvider, null, React.createElement(CompareView, {
      scanResult: result(), scanConfig: {}, onBack() {}, onReviewFiles: (...a) => calls.push(a), ...props,
    })));
  });
  return { el, calls };
}
const click = (node) => act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const title = (el) => el.querySelector('#compare-list-title').textContent;
const buttons = (el, re) => Array.from(el.querySelectorAll('button')).filter(b => re.test(b.textContent) || re.test(b.getAttribute('aria-label') || ''));
const cellTexts = (el, col) => Array.from(el.querySelectorAll('tbody tr')).map(tr => tr.children[col]?.textContent);

describe('CompareView', () => {
  it('opens on "Only in target", with that box highlighted and a footer', () => {
    const { el } = render();
    expect(title(el)).toMatch(/^Only in the Copy/);
    expect(buttons(el, /^1Only in Copy/)[0].getAttribute('aria-pressed')).toBe('true');
    expect(cellTexts(el, 0)).toEqual(['only-tgt.jpg']);
    expect(el.querySelector('section').textContent).toMatch(/1 file · 70\.0 B/);
  });

  it('bar segments switch the list, just like the boxes', () => {
    const { el } = render();
    click(el.querySelector('[aria-label="1 only in Original"]'));
    expect(title(el)).toMatch(/^Only in the Original/);
    expect(el.querySelector('[aria-label="1 only in Original"]').getAttribute('aria-pressed')).toBe('true');
    expect(buttons(el, /^1Only in Original/)[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('"In both" lists target files with their source copy, without leaving the page', () => {
    const { el, calls } = render();
    click(buttons(el, /^2In both/)[0]);
    expect(calls).toEqual([]);                                  // no navigation
    expect(title(el)).toMatch(/^In both/);
    expect(el.querySelector('thead').textContent).toMatch(/Same file in Original/);
    expect(cellTexts(el, 3)).toEqual(['/s/big.jpg', '/s/a.jpg']); // default sort: largest first
    click(buttons(el, /Review and delete/)[0]);
    expect(calls).toEqual([[null]]);
  });

  it('sorts by clicking a column header, and marks the sorted column', () => {
    const { el } = render();
    click(buttons(el, /^2In both/)[0]);
    const sizeBtn = buttons(el, /^Size/)[0];
    expect(sizeBtn.closest('th').getAttribute('aria-sort')).toBe('descending');
    click(sizeBtn);
    expect(buttons(el, /^Size/)[0].closest('th').getAttribute('aria-sort')).toBe('ascending');
    expect(cellTexts(el, 0)).toEqual(['a.jpg', 'big.jpg']);
  });

  it('"By folder" shows the folder table; selecting a folder reviews just its files', () => {
    const { el, calls } = render();
    click(buttons(el, /^2In both/)[0]);
    click(buttons(el, /^By folder$/)[0]);
    expect(el.querySelector('thead').textContent).toMatch(/In Original/);
    click(el.querySelector('[aria-label="Select A"]'));
    click(buttons(el, /Review 2 selected/)[0]);
    expect(calls).toEqual([[['/t/A/a.jpg', '/t/A/big.jpg'], 'A']]);
  });

  it('quick match opens on "In both" and disables "Only in target"', () => {
    const { el } = render({ scanResult: result('quick') });
    expect(title(el)).toMatch(/matched by name and size/);
    expect(buttons(el, /Only in Copy/)[0].disabled).toBe(true);
  });

  it('remembers the chosen list through ui/onUi', () => {
    let saved = null;
    const { el } = render({ onUi: (u) => { saved = u; } });
    click(buttons(el, /^1Only in Original/)[0]);
    expect(saved.tab).toBe('sourceOnly');
    const again = render({ ui: saved });
    expect(title(again.el)).toMatch(/^Only in the Original/);
  });

  it('leads with the backup verdict, and links to the missing files', () => {
    const { el } = render();
    const status = el.querySelector('[role="status"]');
    expect(status.textContent).toMatch(/1 Original file is missing from the Copy/);
    click(buttons(el, /^Show missing files$/)[0]);
    expect(title(el)).toMatch(/^Only in the Original/);
  });

  it('says everything is there when nothing is missing', () => {
    const r = result();
    r.census.sourceOnly = { files: 0, bytes: 0, list: [] };
    const { el } = render({ scanResult: r });
    expect(el.querySelector('[role="status"]').textContent).toMatch(/Everything in the Original is also in the Copy/);
  });
});
