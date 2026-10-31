import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import { serializeRecord, parseRecord, compareRecord, RECORD_NAME } from '../main/integrity.js';

const e = (p, h, over = {}) => ({ p, s: 5, m: '2025-01-01T00:00:00.000Z', h, ...over });

describe('integrity record format', () => {
  it('round-trips, sorted by path, with a header', () => {
    const text = serializeRecord([e('b.jpg', 'hb'), e('a/x.jpg', 'ha')], { root: 'Z:\\Archive' });
    const { header, entries } = parseRecord(text);
    expect(header).toMatchObject({ holdfast: 'integrity-record', version: 1, files: 2, root: 'Z:\\Archive' });
    expect(entries.map(x => x.p)).toEqual(['a/x.jpg', 'b.jpg']);
  });
  it('rejects files that are not a record, and skips a damaged line', () => {
    expect(() => parseRecord('{"hello":1}\n')).toThrow(/Not a Holdfast/);
    const text = serializeRecord([e('a', 'h1'), e('b', 'h2')]).replace('"p":"b"', '"p":"b"').replace(/\n$/, '\n{"p":"broken');
    expect(parseRecord(text).entries).toHaveLength(2);
  });
});

describe('compareRecord', () => {
  it('sorts every file into ok / corrupted / modified / missing / added / unreadable', () => {
    const recorded = [e('ok', 'h'), e('rot', 'h1'), e('edited', 'h2'), e('gone', 'h3'), e('locked', 'h4')];
    const current = [
      e('ok', 'h'),
      e('rot', 'DIFFERENT'),                                            // same size + date, other bytes
      e('edited', 'h2b', { m: '2026-01-01T00:00:00.000Z' }),            // date changed
      e('new', 'h5'),
      { p: 'locked', s: null, m: null, h: null, error: 'File locked' },
    ];
    const r = compareRecord(recorded, current);
    expect(r.ok.map(x => x.p)).toEqual(['ok']);
    expect(r.corrupted.map(x => x.p)).toEqual(['rot']);
    expect(r.modified.map(x => x.p)).toEqual(['edited']);
    expect(r.missing.map(x => x.p)).toEqual(['gone']);
    expect(r.added.map(x => x.p)).toEqual(['new']);
    expect(r.unreadable.map(x => x.p)).toEqual(['locked']);
  });
});

// ── The real worker on a temp archive ────────────────────────────────────────

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-integrity-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const measure = () => new Promise((resolve, reject) => {
  const w = new Worker(path.resolve(__dirname, '../main/integrityWorker.js'), { workerData: { root } });
  w.on('message', (m) => { if (m.type === 'done') { resolve(m.entries); w.terminate(); } else if (m.type === 'error') reject(new Error(m.message)); });
  w.on('error', reject);
});
const put = (rel, body) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; };

describe('integrityWorker', () => {
  it('records every file, skips its own record and quarantine, and catches silent corruption', async () => {
    put('2024/01/a.jpg', 'AAAAA');
    const b = put('2024/02/b.jpg', 'BBBBB');
    put('.holdfast-quarantine/x.jpg', 'ignore me');
    put(RECORD_NAME, 'old record');
    const recorded = await measure();
    expect(recorded.map(x => x.p).sort()).toEqual(['2024/01/a.jpg', '2024/02/b.jpg']);

    // Flip bytes in b without changing its size or date: bit rot.
    const st = fs.statSync(b);
    fs.writeFileSync(b, 'BBBBX');
    fs.utimesSync(b, st.atime, st.mtime);
    put('2024/03/c.jpg', 'CCC');

    const r = compareRecord(recorded, await measure());
    expect(r.corrupted.map(x => x.p)).toEqual(['2024/02/b.jpg']);
    expect(r.ok.map(x => x.p)).toEqual(['2024/01/a.jpg']);
    expect(r.added.map(x => x.p)).toEqual(['2024/03/c.jpg']);
  });
});
