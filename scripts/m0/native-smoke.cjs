// M0 diagnostic only: run with the selected checkout's Electron in Node mode.
// Does not connect to SSH, touch real databases, or open serial devices.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
  const checkout = path.resolve(process.argv[2] || 'upstream/termix');
  const upstream = createRequire(path.join(checkout, 'package.json'));
  assert.ok(process.versions.electron, 'Use Electron with ELECTRON_RUN_AS_NODE=1');
  console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, arch: process.arch }));

  const Database = upstream('better-sqlite3');
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
    db.prepare('INSERT INTO smoke VALUES (?)').run('TandemSSH M0');
    assert.equal(db.prepare('SELECT value FROM smoke').get().value, 'TandemSSH M0');
  } finally {
    db.close();
  }
  console.log('PASS sqlite in-memory write/read');

  const bindings = upstream('@serialport/bindings-cpp');
  assert.ok(bindings.autoDetect());
  console.log('PASS serial native binding load (no hardware test)');

  const pty = upstream('node-pty');
  const terminal = pty.spawn('cmd.exe', ['/d', '/c', 'echo TANDEM_M0_PTY_OK'], {
    name: 'xterm-color', cols: 80, rows: 24, cwd: checkout,
    env: { ...process.env },
  });
  let output = '';
  terminal.onData(data => { output += data; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      terminal.kill();
      reject(new Error('PTY smoke timed out after 10 seconds'));
    }, 10000);
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      try {
        assert.equal(exitCode, 0);
        assert.match(output, /TANDEM_M0_PTY_OK/);
        resolve();
      } catch (error) { reject(error); }
    });
  });
  console.log('PASS PTY command output and exit code');
}

// node-pty can retain native handles briefly after its exit event. This is a
// one-shot diagnostic; after verifying that event, terminate the harness.
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
