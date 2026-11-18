'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  buildScpCommand, checkLocalPaths, parsePort, quoteRemotePath,
  startScpTransfer, ScpValidationError,
} = require('../src/scp-core');

const input = (overrides = {}) => ({
  direction: 'upload',
  host: 'server-in-ssh-config',
  username: 'deploy',
  port: 2222,
  localPath: '/tmp/a file.txt',
  remotePath: '/home/deploy/a file.txt',
  ...overrides,
});

function fakeFileSystem() {
  return { statSync: () => ({ isFile: () => true, isDirectory: () => false }) };
}

test('forces legacy SCP and creates argv, not a shell command', () => {
  const command = buildScpCommand(input());
  assert.equal(command.executable, 'scp');
  assert.deepEqual(command.args.slice(0, 8), [
    '-O', '-B', '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
  ]);
  assert.deepEqual(command.args.slice(-2), [
    path.resolve('/tmp/a file.txt'),
    "deploy@server-in-ssh-config:'/home/deploy/a file.txt'",
  ]);
  assert.ok(command.args.includes('-P'));
  assert.ok(!command.args.includes('-T'), 'strict remote filename checking must remain enabled');
});

test('quotes apostrophes and shell metacharacters in remote paths', () => {
  const evil = "/home/u/it's $(touch /tmp/boom); *.txt";
  const quoted = quoteRemotePath(evil);
  assert.equal(quoted, "'/home/u/it'\\''s $(touch /tmp/boom); *.txt'");
  const command = buildScpCommand(input({ remotePath: evil }));
  assert.equal(command.args.at(-1), `deploy@server-in-ssh-config:${quoted}`);
});

test('download places remote operand first', () => {
  const command = buildScpCommand(input({ direction: 'download', recursive: true, allowUnverifiedRemoteNames: true }));
  assert.deepEqual(command.args.slice(-2), [
    "deploy@server-in-ssh-config:'/home/deploy/a file.txt'",
    path.resolve('/tmp/a file.txt'),
  ]);
  assert.ok(command.args.includes('-r'));
  assert.ok(command.args.includes('-T'));
});

test('simple remote downloads retain strict filename validation', () => {
  const command = buildScpCommand(input({ direction: 'download', remotePath: '/home/deploy/file.txt' }));
  assert.equal(command.args.at(-2), 'deploy@server-in-ssh-config:/home/deploy/file.txt');
  assert.ok(!command.args.includes('-T'));
});

test('complex remote downloads require explicit opt-in', () => {
  assert.throws(() => buildScpCommand(input({ direction: 'download', remotePath: '/home/deploy/a file.txt' })), /explicit opt-in/);
});

test('rejects injection in endpoints and invalid fields', () => {
  for (const host of ['-oProxyCommand=evil', 'a;touch /tmp/pwn', 'host name', 'user@host', 'host:22']) {
    assert.throws(() => buildScpCommand(input({ host })), ScpValidationError);
  }
  assert.throws(() => buildScpCommand(input({ username: 'root;id' })), ScpValidationError);
  assert.throws(() => buildScpCommand(input({ remotePath: 'relative/path' })), ScpValidationError);
  assert.throws(() => buildScpCommand(input({ remotePath: '/tmp/foo\nbar' })), ScpValidationError);
  assert.throws(() => buildScpCommand(input({ direction: 'delete' })), ScpValidationError);
});

test('supports bracketed IPv6 addresses, identity and optional flags', () => {
  const command = buildScpCommand(input({
    host: '[2001:db8::20]', identityFile: '~/.ssh/special key',
    compress: true, preserveTimes: true,
  }));
  assert.equal(command.args.at(-1), "deploy@[2001:db8::20]:'/home/deploy/a file.txt'");
  assert.ok(command.args.includes(path.join(os.homedir(), '.ssh/special key')));
  assert.ok(command.args.includes('-C'));
  assert.ok(command.args.includes('-p'));
});

test('validates port range and allows blank port to defer to ssh config', () => {
  assert.equal(parsePort('2222'), 2222);
  for (const port of ['-1', '0', '65536', '1;id', '1.5', 'abc']) {
    assert.throws(() => parsePort(port), ScpValidationError);
  }
  assert.equal(parsePort(''), null);
  assert.ok(!buildScpCommand(input({port: ''})).args.includes('-P'));
});

test('checks local sources and missing download destination parent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-scp-test-'));
  try {
    const sourceDir = path.join(tmp, 'directory');
    const sourceFile = path.join(tmp, 'file.txt');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(sourceFile, 'x');
    const uploadFile = input({localPath: sourceFile});
    checkLocalPaths(uploadFile, buildScpCommand(uploadFile));
    const uploadDir = input({localPath: sourceDir});
    assert.throws(() => checkLocalPaths(uploadDir, buildScpCommand(uploadDir)), /recursive/);
    const download = input({direction: 'download', localPath: path.join(tmp,'download.txt')});
    checkLocalPaths(download, buildScpCommand(download));
    const badDownload = input({direction: 'download', localPath: path.join(tmp,'missing','file.txt')});
    assert.throws(() => checkLocalPaths(badDownload, buildScpCommand(badDownload)), /parent/);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test('start spawns without a shell, reports output and completion', async () => {
  let received;
  const output = [];
  const fakeSpawn = (executable, args, options) => {
    received = {executable, args, options};
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stderr.write('copying...');
      child.emit('close', 0, null);
    });
    return child;
  };
  const task = startScpTransfer(input(), (chunk, stream) => output.push([stream, chunk]), {
    spawn: fakeSpawn, fs: fakeFileSystem(),
  });
  const result = await task.completed;
  assert.equal(received.executable, 'scp');
  assert.equal(received.options.shell, false);
  assert.equal(result.ok, true);
  assert.deepEqual(output, [['stderr', 'copying...']]);
  assert.equal(task.cancel(), false);
});

test('can cancel an in-flight transfer', async () => {
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      setImmediate(() => child.emit('close', null, 'SIGTERM'));
      return true;
    };
    return child;
  };
  const task = startScpTransfer(input(), () => {}, {spawn: fakeSpawn, fs: fakeFileSystem()});
  assert.equal(task.cancel(), true);
  const result = await task.completed;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
});
