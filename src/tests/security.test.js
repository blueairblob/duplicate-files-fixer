import { describe, it, expect } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';
import { makeAppUrlCheck, CSP } from '../main/security.js';

const indexPath = path.resolve('/app/dist/index.html');
const fileUrl = pathToFileURL(indexPath).href;

describe('makeAppUrlCheck', () => {
  it('accepts only the built index.html in production', () => {
    const ok = makeAppUrlCheck({ isDev: false, devUrl: 'http://localhost:5173', indexPath });
    expect(ok(fileUrl)).toBe(true);
    expect(ok(fileUrl + '#/results')).toBe(true);
    expect(ok(pathToFileURL(path.resolve('/app/dist/other.html')).href)).toBe(false);
    expect(ok(pathToFileURL(path.resolve('/Users/me/Downloads/evil.html')).href)).toBe(false);
    expect(ok('http://localhost:5173/')).toBe(false);
    expect(ok('https://example.com/')).toBe(false);
    expect(ok('')).toBe(false);
    expect(ok(undefined)).toBe(false);
    expect(ok('not a url')).toBe(false);
  });

  it('accepts only the dev server origin in development', () => {
    const ok = makeAppUrlCheck({ isDev: true, devUrl: 'http://localhost:5173', indexPath });
    expect(ok('http://localhost:5173/')).toBe(true);
    expect(ok('http://localhost:5173/src/main.jsx')).toBe(true);
    expect(ok('http://localhost:5174/')).toBe(false);
    expect(ok(fileUrl)).toBe(false);
  });
});

describe('CSP', () => {
  it('allows only same-origin scripts and blocks plugins, frames and forms', () => {
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toMatch(/script-src[^;]*unsafe/);
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("frame-src 'none'");
    expect(CSP).toContain("form-action 'none'");
  });
});
