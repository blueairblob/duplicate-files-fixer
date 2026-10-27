#!/usr/bin/env node
// run-smoke.js — runs a packaged build in smoke mode (DFF_SMOKE=1) and checks
// its report. Finds the executable under release/ when no path is given.
//
//   node tools/run-smoke.js [path-to-executable] [-- extra electron args]
//
// DFF_RELEASE_DIR overrides where to look (default: release/).
//
// Exit code 0 = the packaged page rendered under sandbox + CSP and a real scan
// found the expected duplicate. See runSmoke() in src/main/main.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sep = process.argv.indexOf('--');
const extraArgs = sep >= 0 ? process.argv.slice(sep + 1) : [];
let exe = sep === 2 ? null : process.argv[2];

function findExecutable() {
  const release = process.env.DFF_RELEASE_DIR || path.join(__dirname, '..', 'release');
  const dirs = fs.existsSync(release) ? fs.readdirSync(release) : [];
  for (const d of dirs) {
    const full = path.join(release, d);
    if (d === 'win-unpacked') return path.join(full, 'Duplicate Files Fixer.exe');
    if (d === 'linux-unpacked') return path.join(full, 'duplicate-files-fixer');
    if (d.startsWith('mac')) {
      const app = fs.readdirSync(full).find(f => f.endsWith('.app'));
      if (app) return path.join(full, app, 'Contents', 'MacOS', app.replace(/\.app$/, ''));
    }
  }
  return null;
}

exe = exe || findExecutable();
if (!exe || !fs.existsSync(exe)) {
  console.error(`run-smoke: no packaged executable found (${exe || 'release/ is empty'}). Run "npm run pack" first.`);
  process.exit(2);
}

const out = path.join(os.tmpdir(), `dff-smoke-${process.pid}.json`);
fs.rmSync(out, { force: true });
console.log(`run-smoke: ${exe} ${extraArgs.join(' ')}`);

const child = spawn(exe, extraArgs, {
  env: { ...process.env, DFF_SMOKE: '1', UV_THREADPOOL_SIZE: '64', DFF_SMOKE_OUT: out },
  stdio: 'inherit',
});
const timer = setTimeout(() => { console.error('run-smoke: timed out after 120 s'); child.kill('SIGKILL'); }, 120000);

child.on('exit', (code) => {
  clearTimeout(timer);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* none */ }
  fs.rmSync(out, { force: true });
  if (!report) {
    console.error(`run-smoke: no report written (exit code ${code})`);
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`run-smoke: ${report.ok ? 'PASS' : 'FAIL'} (exit code ${code})`);
  process.exit(report.ok && code === 0 ? 0 : 1);
});
