// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ResultsView from '../renderer/views/ResultsView.jsx';
import { DPRProvider } from '../renderer/contexts/DPRContext.jsx';

// Renders the real Results screen with a large scan result (Phase C, M5).

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

// Minimal DOM helpers (no @testing-library/dom in this project).
const textNodes = (root, re) => Array.from(root.querySelectorAll('*'))
  .filter(el => Array.from(el.childNodes).some(n => n.nodeType === 3 && re.test(n.textContent)));
const byExactText = (root, text) => textNodes(root, new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
const groupCards = (root) => Array.from(root.querySelectorAll('span')).filter(el => /^\d+ identical copies ·/.test(el.textContent));
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

function bigResult(n) {
  const groups = Array.from({ length: n }, (_, i) => ({
    id: i,
    hash: `h${i}`,
    hasProtected: false,
    autoMarked: [`/t/b${i}.jpg`],
    files: [
      { path: `/t/a${i}.jpg`, name: `a${i}.jpg`, size: 1000, modified: '2026-01-01T00:00:00.000Z', ext: '.jpg', sourceLabel: 'target' },
      { path: `/t/b${i}.jpg`, name: `b${i}.jpg`, size: 1000, modified: '2025-01-01T00:00:00.000Z', ext: '.jpg', sourceLabel: 'target' },
    ],
  }));
  return { groups, totalScanned: n * 2, mode: 'simple', warnings: [], confidence: 'thorough', emptyFiles: [] };
}

function renderResults(result) {
  const container = document.createElement('div');
  document.body.innerHTML = '';
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      React.createElement(DPRProvider, null,
        React.createElement(ResultsView, { scanResult: result, scanConfig: {}, onDeleteComplete() {}, onBack() {} })));
  });
  return container;
}

describe('ResultsView with a large result', () => {
  it('renders one page of groups, collapsed, and pages on demand', () => {
    const t0 = performance.now();
    const root = renderResults(bigResult(5000));
    const ms = performance.now() - t0;

    expect(root.textContent).toContain('5,000 duplicate groups');
    expect(groupCards(root)).toHaveLength(200);
    expect(root.querySelector('[title="/t/a0.jpg"]')).toBeNull(); // collapsed: no file rows yet
    expect(ms).toBeLessThan(3000);

    click(Array.from(root.querySelectorAll('button')).find(b => /Show 200 more of 4,800 remaining groups/.test(b.textContent)));
    expect(groupCards(root)).toHaveLength(400);
  });

  it('auto-selects one copy per group and updates the count when a file is ticked', () => {
    const root = renderResults(bigResult(300));
    expect(root.textContent).toContain('Delete 300 files');

    click(byExactText(root, 'a0.jpg')[0]);                  // expand the first group
    click(root.querySelector('[title="/t/b0.jpg"]'));       // untick its auto-selected copy
    expect(root.textContent).toContain('Delete 299 files');
  });
});
