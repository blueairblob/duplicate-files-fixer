// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { DPRProvider, useDPR } from '../renderer/contexts/DPRContext.jsx';
import { setLegacyScaling } from '../renderer/hooks/useDPR.js';

// The OS scales the app by default; the old HiDPI shrink is opt-in.

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
});

function Probe() {
  const { scale, legacyScaling } = useDPR();
  return React.createElement('span', { 'data-size': scale(13), 'data-legacy': String(legacyScaling) });
}

describe('HiDPI scaling', () => {
  it('is 1:1 by default on a 200% screen, and shrinks only when the legacy setting is on', () => {
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    act(() => { createRoot(el).render(React.createElement(DPRProvider, null, React.createElement(Probe))); });
    const probe = () => el.querySelector('span');

    expect(probe().dataset.size).toBe('13');
    expect(probe().dataset.legacy).toBe('false');

    act(() => setLegacyScaling(true));
    expect(probe().dataset.size).toBe('10');   // 13px × 10/13 at the 2.0 tier

    act(() => setLegacyScaling(false));
    expect(probe().dataset.size).toBe('13');
  });
});
