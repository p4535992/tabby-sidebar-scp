'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  buildListCommand, buildMoveCommand, parseRemoteEntries,
  listLocalDirectory, listRemoteDirectory, moveLocalEntry, moveRemoteEntry,
  joinRemoteDirectory, parentRemoteDirectory,
} = require('../src/scp-browser');

const host = { host: 'example-ssh', username: 'alice', port: '2222' };
function fakeSpawn(stdout = '', code = 0) {
  return (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => child.emit('close', null)); return true; };
    setImmediate(() => {
      if (stdout) child.stdout.write(Buffer.from(stdout));
      child.emit('close', code);
    });
    assert.equal(executable, 'ssh');
    assert.equal(options.shell, false);
    return child;
  };
}

test('remote directory listing uses quoted POSIX path and strict SSH options', () => {
  const command = buildListCommand(host, "/data/it's a space");
  assert.equal(command.executable, 'ssh');
  assert.ok(command.args.includes('StrictHostKeyChecking=yes'));
  assert.deepEqual(command.args.slice(-2), [
    'alice@example-ssh',
    String.raw`LC_ALL=C find -- '/data/it'\''s a space' -mindepth 1 -maxdepth 1 -printf '%y\t%f\t%s\t%T@\t%m\0'`,
  ]);
  assert.throws(() => buildListCommand(host, 'relative/path'), /absolute/);
  assert.throws(() => buildListCommand({host: '-bad'}, '/tmp'), /Host/);
});

test('parses NUL-delimited file and directory entries without splitting whitespace', () => {
  const content = Buffer.from('f\tFile with spaces.txt\t1024\t1700000000.5\t644\0d\tFolder name\t4096\t1700000000.0\t755\0l\tsoft-link\t12\t1700000000.0\t777\0');
  assert.deepEqual(parseRemoteEntries(content, '/home/alice').map(e => [e.name, e.isDirectory, e.isSymbolicLink]), [
    ['Folder name', true, false], ['File with spaces.txt', false, false], ['soft-link', false, true],
  ]);
  const parsed = parseRemoteEntries(content, '/home/alice');
  assert.equal(parsed.find(e => e.name === 'File with spaces.txt').size, 1024);
  assert.equal(parsed.find(e => e.name === 'File with spaces.txt').modifiedAt, 1700000000500);
  assert.throws(() => parseRemoteEntries(Buffer.from('f\tfoo\t123\t1700000000.0\t644'), '/tmp'), /Malformed/);
  assert.throws(() => parseRemoteEntries(Buffer.from('f\tbad\tnot-a-size\t1\t644\0'), '/tmp'), /metadata/);
  assert.throws(() => parseRemoteEntries(Buffer.from('f\t../bad\t123\t1700000000.0\t644\0'), '/tmp'), /Invalid/);
});

test('remote read is a safe no-shell child process', async () => {
  const output = 'd\tbackup\t4096\t1700000000.0\t755\0f\tnew.txt\t20\t1700000000.5\t644\0';
  const result = await listRemoteDirectory(host, '/srv', { spawn: fakeSpawn(output) });
  assert.deepEqual(result.entries.map(e => e.path), ['/srv/backup', '/srv/new.txt']);
});

test('remote move refuses overwrite using remote test and avoids injection', async () => {
  const cmd = buildMoveCommand(host, "/srv/a's", '/srv/new name');
  assert.ok(cmd.args.at(-1).includes('test ! -e'));
  assert.ok(cmd.args.at(-1).includes('mv -- '));
  assert.ok(cmd.args.at(-1).includes("'/srv/a'\\''s'"));
  assert.throws(() => buildMoveCommand(host, '/srv/a', '/srv/a/b'), /outside source/);
  await moveRemoteEntry(host, '/srv/a', '/srv/b', { spawn: fakeSpawn() });
});

test('directory helpers reject malformed remote entry names', () => {
  assert.equal(joinRemoteDirectory('/root', 'a b'), '/root/a b');
  assert.equal(parentRemoteDirectory('/srv/a'), '/srv');
  for (const value of ['../x', 'bad/name', 'bad\nname']) {
    assert.throws(() => joinRemoteDirectory('/srv', value), /Invalid/);
  }
});

test('local browser lists files and moving refuses overwrite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-browser-'));
  try {
    fs.mkdirSync(path.join(dir, 'folder'));
    fs.writeFileSync(path.join(dir, 'source.txt'), 'data');
    fs.writeFileSync(path.join(dir, 'exists.txt'), 'data');
    const listing = await listLocalDirectory(dir);
    assert.deepEqual(listing.entries.map(e => e.name), ['folder', 'exists.txt', 'source.txt']);
    assert.equal(listing.entries.find(e => e.name === 'source.txt').size, 4);
    assert.ok(listing.entries.find(e => e.name === 'source.txt').modifiedAt > 0);
    await assert.rejects(moveLocalEntry(path.join(dir, 'source.txt'), path.join(dir, 'exists.txt')), /already exists/);
    await moveLocalEntry(path.join(dir, 'source.txt'), path.join(dir, 'new name.txt'));
    assert.equal(fs.readFileSync(path.join(dir, 'new name.txt'), 'utf8'), 'data');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('new directory command uses safely quoted remote path', () => {
  const browser = require('../src/scp-browser');
  const command = browser.buildMkdirCommand({ host: 'server', username: 'u' }, "/home/u/it's here");
  assert.equal(command.executable, 'ssh');
  assert.equal(command.args.at(-1).startsWith('mkdir -- '), true);
  assert.ok(command.args.includes('-T'));
  assert.throws(() => browser.buildMkdirCommand({ host: 'server' }, 'relative'), /absolute/);
});

test('new local directory refuses overwrites', async () => {
  const browser = require('../src/scp-browser');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-folder-'));
  try {
    const destination = path.join(parent, 'new folder');
    await browser.createLocalDirectory(destination);
    assert.ok(fs.statSync(destination).isDirectory());
    await assert.rejects(browser.createLocalDirectory(destination), /EEXIST/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
