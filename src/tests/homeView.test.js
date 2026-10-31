// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import HomeView from '../renderer/views/HomeView.jsx';
import { DPRProvider } from '../renderer/contexts/DPRContext.jsx';

// Home has two jobs. Check how each maps onto the scan engine.

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function render(preset) {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.innerHTML = '';
  document.body.appendChild(el);
  const started = [];
  act(() => {
    createRoot(el).render(React.createElement(DPRProvider, null,
      React.createElement(HomeView, { onStartScan: (c) => started.push(c), preset: preset ? { key: 'k1', ...preset } : null })));
  });
  return { el, started };
}
const click = (node) => act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const button = (el, re) => Array.from(el.querySelectorAll('button')).find(b => re.test(b.textContent));
// The start button shares its label with the job switch; it's the last one.
const startFind = (el) => Array.from(el.querySelectorAll('button')).filter(b => b.textContent === 'Find duplicates').at(-1);
const flush = () => act(async () => { await Promise.resolve(); });

describe('HomeView jobs', () => {
  it('offers five stages in the order data travels, Import first', () => {
    const { el } = render();
    const jobs = Array.from(el.querySelectorAll('[aria-label="What do you want to do?"] button')).map(b => b.getAttribute('aria-label'));
    expect(jobs).toEqual(['Import from device', 'Move to backup', 'Check backup', 'Clean up duplicates', 'Archive backup']);
    expect(el.querySelector('h1').textContent).toBe('Import from device');
  });

  it('Import copies into the Inbox, and also skips what the backup already has', async () => {
    const { el, started } = render({ job: 'import', protectedFolders: ['/inbox', '/nas'], targetFolders: ['/sd/DCIM'] });
    click(button(el, /^See what’s new$/));
    await flush();
    expect(started[0]).toMatchObject({ job: 'import', mode: 'compare', protectedFolders: ['/inbox', '/nas'], targetFolders: ['/sd/DCIM'], confidence: 'thorough' });
  });

  it('Archive copies the backup into the archive folder', async () => {
    const { el, started } = render({ job: 'archive', protectedFolders: ['/offline'], targetFolders: ['/nas/Photos'] });
    click(button(el, /^See what to archive$/));
    await flush();
    expect(started[0]).toMatchObject({ job: 'archive', mode: 'compare', protectedFolders: ['/offline'], targetFolders: ['/nas/Photos'], confidence: 'thorough' });
  });

  it('Move to backup scans the backup as protected and the local copy as target, always Thorough', async () => {
    const { el, started } = render({ job: 'move', protectedFolders: ['/nas/Photos'], targetFolders: ['/phone'] });
    click(button(el, /^See what’s new$/));
    await flush();
    expect(started[0]).toMatchObject({ job: 'move', mode: 'compare', protectedFolders: ['/nas/Photos'], targetFolders: ['/phone'], confidence: 'thorough' });
  });

  it('Find with a Keep folder scans Keep as protected and the rest as the clean-up target', async () => {
    const { el, started } = render({ job: 'find', protectedFolders: ['/keep'], targetFolders: ['/clean'] });
    click(startFind(el));
    await flush();
    expect(started[0]).toMatchObject({ job: 'find', mode: 'compare', protectedFolders: ['/keep'], targetFolders: ['/clean'] });
  });

  it('Find without Keep folders is a plain duplicate scan', async () => {
    const { el, started } = render({ job: 'find', protectedFolders: ['/keep'], targetFolders: ['/clean'] });
    click(el.querySelector('button[aria-pressed="true"][title^="Kept"]'));   // un-Keep /keep
    click(startFind(el));
    await flush();
    expect(started[0]).toMatchObject({ job: 'find', mode: 'simple', protectedFolders: [] });
    expect(started[0].targetFolders.sort()).toEqual(['/clean', '/keep']);
  });

  it('Find needs at least one folder that is not Keep', () => {
    const { el } = render({ job: 'find', protectedFolders: ['/keep'], targetFolders: [] });
    expect(el.textContent).toMatch(/Every folder is marked Keep/);
  });

  it('Compare maps Original/Copy to protected/target and defaults to Thorough', async () => {
    const { el, started } = render({ job: 'compare', protectedFolders: ['/orig'], targetFolders: ['/copy'] });
    click(button(el, /^Compare$/));
    await flush();
    expect(started[0]).toMatchObject({ job: 'compare', mode: 'compare', protectedFolders: ['/orig'], targetFolders: ['/copy'], confidence: 'thorough' });
  });

  it('old history entries map onto the new jobs', () => {
    expect(render({ mode: 'verify', protectedFolders: ['/a'], targetFolders: ['/b'] }).el.querySelector('h1').textContent).toBe('Check backup');
    expect(render({ mode: 'compare', protectedFolders: ['/a'], targetFolders: ['/b'] }).el.querySelector('h1').textContent).toBe('Check backup');
    const simple = render({ mode: 'simple', protectedFolders: [], targetFolders: ['/x'] }).el;
    expect(simple.querySelector('h1').textContent).toBe('Clean up duplicates');
  });
});
