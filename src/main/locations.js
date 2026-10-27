// Drive/network location detection for the folder browser. All async: the
// Windows lookups shell out to PowerShell, which used to block the main
// process (and freeze the window) for seconds via execSync.
//
// Unified format: { label, path, icon: 'home'|'desktop'|'documents'|'downloads'|
//   'pictures'|'music'|'videos'|'hdd'|'usb'|'network'|'disc'|'drive' }

const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { runCapture } = require('./system');

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };
const readText = async (p) => { try { return await fsp.readFile(p, 'utf8'); } catch { return null; } };
const readDir = async (p) => { try { return await fsp.readdir(p, { withFileTypes: true }); } catch { return []; } };
const parseJsonList = (out) => {
  try { const v = JSON.parse(out); return Array.isArray(v) ? v : v ? [v] : []; } catch { return null; }
};

async function getWindowsLocations() {
  const locations = [];
  const [drivesOut, smbOut] = await Promise.all([
    runCapture('powershell', ['-NoProfile', '-Command', 'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Description,Free,Used | ConvertTo-Json -Compress']),
    runCapture('powershell', ['-NoProfile', '-Command', 'Get-SmbMapping | Select-Object LocalPath,RemotePath | ConvertTo-Json -Compress']),
  ]);

  const drives = drivesOut ? parseJsonList(drivesOut) : null;
  if (drives) {
    for (const d of drives) {
      if (!d.Name) continue;
      const sizeLabel = d.Used != null && d.Free != null ? ` — ${formatBytes(d.Used + d.Free)}` : '';
      locations.push({ label: `${d.Description || 'Local Disk'} (${d.Name}:)${sizeLabel}`, path: `${d.Name}:\\`, icon: 'hdd' });
    }
  } else {
    // Fallback if PowerShell is unavailable
    const out = await runCapture('wmic', ['logicaldisk', 'get', 'name,drivetype,description', '/format:csv']);
    for (const line of (out || '').split('\n').slice(2)) {
      const parts = line.trim().split(',');
      if (parts.length < 4) continue;
      const [, desc, driveType, name] = parts;
      if (!name) continue;
      const drivePath = name.trim() + '\\';
      const icon = { 2: 'usb', 3: 'hdd', 4: 'network', 5: 'disc' }[parseInt(driveType, 10)] || 'drive';
      locations.push({ label: `${desc.trim() || drivePath} (${drivePath})`, path: drivePath, icon });
    }
  }

  const mappings = smbOut ? parseJsonList(smbOut) : null;
  if (mappings && mappings.length) {
    for (const m of mappings) {
      if (!m.LocalPath || !m.RemotePath) continue;
      locations.push({ label: `${m.RemotePath} (${m.LocalPath})`, path: m.LocalPath + '\\', icon: 'network' });
    }
  } else {
    const netOut = await runCapture('net', ['use']);
    for (const line of (netOut || '').split('\n')) {
      const match = line.match(/([A-Z]:)\s+(\\\\\S+)/);
      if (match) locations.push({ label: `Network: ${match[2]} (${match[1]})`, path: match[1] + '\\', icon: 'network' });
    }
  }
  return locations;
}

async function getMacLocations() {
  const locations = [];
  for (const v of await readDir('/Volumes')) {
    // The boot volume is already covered by Home/Desktop/etc.
    if (v.name === 'Macintosh HD') continue;
    if (v.isDirectory() || v.isSymbolicLink()) {
      // Finder-mounted shares also live here; only mark network when the name hints at it.
      const looksNetwork = /^(smb|afp|nfs)[-_]/i.test(v.name) || v.name.includes('on ');
      locations.push({ label: v.name, path: `/Volumes/${v.name}`, icon: looksNetwork ? 'network' : 'drive' });
    }
  }
  return locations;
}

async function getLinuxLocations() {
  const locations = [];
  const has = (p) => locations.some(l => l.path === p);
  const isWSL = ((await readText('/proc/version')) || '').toLowerCase().includes('microsoft');

  // WSL: /mnt/c, /mnt/d etc. as friendly "Windows drive" shortcuts
  if (isWSL) {
    for (const e of await readDir('/mnt')) {
      if (e.isDirectory() && /^[a-z]$/.test(e.name)) {
        locations.push({ label: `Windows ${e.name.toUpperCase()}: drive (/mnt/${e.name})`, path: `/mnt/${e.name}`, icon: 'hdd' });
      }
    }
  }

  const NETWORK_FS = new Set(['nfs', 'nfs4', 'cifs', 'smbfs', 'smb3']);
  const SKIP_FS = new Set(['proc', 'sysfs', 'devtmpfs', 'tmpfs', 'devpts', 'cgroup', 'cgroup2', 'overlay', 'squashfs', 'debugfs', 'tracefs', 'mqueue', 'securityfs', 'pstore', 'bpf', 'autofs', 'binfmt_misc']);
  for (const line of ((await readText('/proc/mounts')) || '').split('\n')) {
    const [device, mountPoint, fsType] = line.trim().split(/\s+/);
    if (!fsType || SKIP_FS.has(fsType)) continue;
    if (mountPoint === '/' || mountPoint.startsWith('/boot') || mountPoint.startsWith('/snap')) continue;
    if (isWSL && mountPoint.startsWith('/mnt/')) continue; // added above with friendly labels
    if (NETWORK_FS.has(fsType)) {
      locations.push({ label: `Network: ${device} (${mountPoint})`, path: mountPoint, icon: 'network' });
    } else if (mountPoint.startsWith('/media/') || mountPoint.startsWith('/run/media/')) {
      locations.push({ label: `${path.basename(mountPoint)} (${mountPoint})`, path: mountPoint, icon: 'usb' });
    }
  }

  // /media/<user>/<device> layouts that /proc/mounts parsing may miss
  for (const base of ['/media', '/run/media']) {
    for (const entry of await readDir(base)) {
      if (!entry.isDirectory()) continue;
      for (const s of await readDir(path.join(base, entry.name))) {
        const fullPath = path.join(base, entry.name, s.name);
        if (s.isDirectory() && !has(fullPath)) locations.push({ label: `${s.name} (${fullPath})`, path: fullPath, icon: 'usb' });
      }
    }
  }

  // Network shares declared in /etc/fstab (may not be mounted right now)
  for (const line of ((await readText('/etc/fstab')) || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (t.startsWith('//') || /\bnfs\b/.test(t) || /\bcifs\b/.test(t)) {
      const parts = t.split(/\s+/);
      if (parts[1] && parts[1].startsWith('/') && !has(parts[1])) {
        locations.push({ label: `Network: ${parts[0]} → ${parts[1]}`, path: parts[1], icon: 'network' });
      }
    }
  }
  return locations;
}

async function getLocations() {
  const home = os.homedir();
  const locations = [{ label: 'Home', path: home, icon: 'home' }];
  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) {
    const p = path.join(home, name);
    if (await exists(p)) locations.push({ label: name, path: p, icon: name.toLowerCase() });
  }
  if (process.platform === 'win32') locations.push(...await getWindowsLocations());
  else if (process.platform === 'darwin') locations.push(...await getMacLocations());
  else locations.push(...await getLinuxLocations());
  return locations;
}

module.exports = { getLocations };
