'use strict';

/**
 * Remote file operations on the SSH connection Tabby has already authenticated.
 *
 * Listing, mkdir and move reuse the same POSIX commands as the manual mode, so
 * both paths see identical metadata. Transfers speak the legacy SCP protocol
 * (`scp -t` / `scp -f`) on an exec channel: no SFTP subsystem is needed, no
 * local `scp`/`ssh` process is spawned and no local key or agent is used.
 *
 * The remote shell is the login shell, exactly like `scp` itself; commands stay
 * POSIX-sh compatible and never interpolate unquoted paths.
 */
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');
const posix = path.posix;
const { ScpValidationError, quoteRemotePath } = require('./scp-core');
const {
  listCommandText, mkdirCommandText, moveCommandText, parseRemoteEntries,
} = require('./scp-browser');

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_BYTES = 8192;
const CHUNK_SIZE = 256 * 1024;
const SCP_ACK = 0;
const SCP_WARNING = 1;
const SCP_FATAL = 2;
const PROGRESS_INTERVAL_MS = 120;

class ScpSessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScpSessionError';
  }
}

/** Buffered byte stream fed by channel events, consumed by the protocol code. */
class ByteQueue {
  constructor(maxBytes = 0, onOverflow = null) {
    this.parts = [];
    this.size = 0;
    this.ended = false;
    this.failure = null;
    this.waiters = [];
    this.maxBytes = maxBytes;
    this.onOverflow = onOverflow;
  }

  push(chunk) {
    if (this.failure || !chunk || !chunk.length) return;
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.parts.push(part);
    this.size += part.length;
    if (this.maxBytes && this.size > this.maxBytes) {
      this.parts = [];
      this.size = 0;
      this.fail(new ScpSessionError('The remote result is too large; open a smaller directory'));
      if (this.onOverflow) this.onOverflow();
      return;
    }
    this.wake();
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.wake();
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    this.ended = true;
    this.wake();
  }

  wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  wait() {
    return new Promise(resolve => this.waiters.push(resolve));
  }

  async ensure(count) {
    while (this.size < count) {
      if (this.failure) throw this.failure;
      if (this.ended) throw new ScpSessionError('The SSH channel closed before the operation completed');
      await this.wait();
    }
  }

  async read(count) {
    await this.ensure(count);
    const output = Buffer.allocUnsafe(count);
    let offset = 0;
    while (offset < count) {
      const head = this.parts[0];
      const take = Math.min(head.length, count - offset);
      head.copy(output, offset, 0, take);
      offset += take;
      if (take === head.length) this.parts.shift();
      else this.parts[0] = head.subarray(take);
    }
    this.size -= count;
    return output;
  }

  async readByte() {
    return (await this.read(1))[0];
  }

  /** Read one `\n`-terminated protocol line without its terminator. */
  async readLine() {
    for (;;) {
      const index = this.indexOfNewline();
      if (index >= 0) {
        const line = await this.read(index);
        await this.read(1);
        return line.toString('utf8');
      }
      if (this.failure) throw this.failure;
      if (this.ended) throw new ScpSessionError('The SSH channel closed during the SCP handshake');
      await this.wait();
    }
  }

  indexOfNewline() {
    let offset = 0;
    for (const part of this.parts) {
      const index = part.indexOf(10);
      if (index >= 0) return offset + index;
      offset += part.length;
    }
    return -1;
  }

  /** Hand buffered bytes to `sink` as they arrive, keeping memory bounded. */
  async readInto(count, sink) {
    let remaining = count;
    while (remaining > 0) {
      await this.ensure(1);
      const head = this.parts[0];
      const take = Math.min(head.length, remaining);
      const chunk = head.subarray(0, take);
      if (take === head.length) this.parts.shift();
      else this.parts[0] = head.subarray(take);
      this.size -= take;
      remaining -= take;
      await sink(chunk);
    }
  }

  takeAll() {
    const output = Buffer.concat(this.parts);
    this.parts = [];
    this.size = 0;
    return output;
  }
}

/** Wrap a russh channel into a queue pair plus the write/close primitives. */
function attachChannel(channel, maxBytes = 0) {
  const errors = [];
  const subscriptions = [];
  const closeWaiters = [];
  let errorBytes = 0;
  let closed = false;
  const closeChannel = async () => {
    try {
      await channel.close();
    } catch { /* Already closed by the remote side. */ }
  };
  const stdout = new ByteQueue(maxBytes, () => { void closeChannel(); });

  const onClosed = () => {
    closed = true;
    stdout.end();
    const waiters = closeWaiters.splice(0, closeWaiters.length);
    for (const resolve of waiters) resolve();
  };

  subscriptions.push(channel.data$.subscribe(chunk => stdout.push(chunk)));
  subscriptions.push(channel.extendedData$.subscribe(event => {
    const data = Array.isArray(event) ? event[1] : event;
    if (!data || errorBytes >= MAX_ERROR_BYTES) return;
    const part = Buffer.isBuffer(data) ? data : Buffer.from(data);
    errors.push(part);
    errorBytes += part.length;
  }));
  subscriptions.push(channel.eof$.subscribe(() => stdout.end()));
  subscriptions.push(channel.closed$.subscribe(onClosed));

  return {
    stdout,
    get stderrText() {
      return Buffer.concat(errors).toString('utf8').trim();
    },
    write: data => channel.write(data),
    close: closeChannel,
    waitForClose: () => (closed ? Promise.resolve() : new Promise(resolve => closeWaiters.push(resolve))),
    dispose: () => {
      for (const subscription of subscriptions) subscription.unsubscribe();
    },
  };
}

/** The authenticated russh client behind an SSH tab. */
function requireClient(tab) {
  const client = tab && tab.sshSession && tab.sshSession.ssh;
  if (!client || typeof client.openSessionChannel !== 'function' || typeof client.activateChannel !== 'function') {
    throw new ScpSessionError('The SSH session is not ready; reconnect the tab and try again');
  }
  return client;
}

/** Open an exec channel on the existing connection, like Tabby does for shells. */
async function openExecChannel(tab, command) {
  const client = requireClient(tab);
  const channel = await client.activateChannel(await client.openSessionChannel());
  await channel.requestExec(command);
  return channel;
}

/**
 * Run one remote command and return its stdout. The channel API exposes no exit
 * status, so a non-empty stderr is treated as a failure: every command used here
 * reports its errors there and stays silent on success.
 */
async function runRemoteCommand(tab, command) {
  const remote = attachChannel(await openExecChannel(tab, command), MAX_OUTPUT_BYTES);
  try {
    await remote.waitForClose();
    if (remote.stdout.failure) throw remote.stdout.failure;
    const output = remote.stdout.takeAll();
    const stderr = remote.stderrText;
    if (stderr) throw new ScpSessionError(stderr);
    return output;
  } finally {
    remote.dispose();
    await remote.close();
  }
}

async function listSessionDirectory(tab, directory) {
  const output = await runRemoteCommand(tab, listCommandText(directory));
  return { directory, entries: parseRemoteEntries(output, directory) };
}

async function createSessionDirectory(tab, directory) {
  await runRemoteCommand(tab, mkdirCommandText(directory));
}

async function moveSessionEntry(tab, source, destination) {
  await runRemoteCommand(tab, moveCommandText(source, destination));
}

function checkCancelled(options) {
  if (options.isCancelled && options.isCancelled()) throw new ScpSessionError('Transfer cancelled');
}

function createProgress(options, totalBytes) {
  let transferred = 0;
  let lastReport = 0;
  const report = () => {
    if (!options.onProgress) return;
    options.onProgress(transferred, totalBytes > 0 ? totalBytes : undefined);
  };
  return {
    advance(bytes) {
      transferred += bytes;
      const now = Date.now();
      if (now - lastReport < PROGRESS_INTERVAL_MS) return;
      lastReport = now;
      report();
    },
    finish() {
      report();
    },
  };
}

/** Read one SCP acknowledgement: 0 success, 1 warning, 2 fatal. */
async function readAck(remote, options) {
  const code = await remote.stdout.readByte();
  if (code === SCP_ACK) return;
  if (code === SCP_WARNING || code === SCP_FATAL) {
    const message = await remote.stdout.readLine();
    if (code === SCP_FATAL) throw new ScpSessionError(message || 'The remote SCP process reported an error');
    if (options.onWarning) options.onWarning(message);
    return;
  }
  throw new ScpSessionError(`Unexpected SCP response ${code}`);
}

/** `mode size name` from a C/D record; the name may contain spaces. */
function parseRecord(line) {
  const firstSpace = line.indexOf(' ');
  const secondSpace = line.indexOf(' ', firstSpace + 1);
  if (firstSpace < 0 || secondSpace < 0) throw new ScpSessionError('Malformed SCP record');
  const mode = Number.parseInt(line.slice(0, firstSpace), 8);
  const size = Number(line.slice(firstSpace + 1, secondSpace));
  const name = line.slice(secondSpace + 1);
  if (!Number.isFinite(mode) || !Number.isFinite(size) || size < 0) {
    throw new ScpSessionError('Malformed SCP record');
  }
  return { mode, size, name };
}

/** SCP record names cannot carry separators or control characters. */
function recordName(name) {
  if (!name || name === '.' || name === '..' || name.includes('/') || /[\x00-\x1f\x7f]/.test(name)) {
    throw new ScpValidationError('Invalid remote entry name');
  }
  return name;
}

function remoteMode(stats) {
  return (stats.mode & 0o7777).toString(8).padStart(4, '0');
}

/** Send one file or directory tree to `scp -t`. */
async function sendEntry(remote, localPath, name, stats, progress, options) {
  checkCancelled(options);
  if (stats.isDirectory()) {
    await remote.write(Buffer.from(`D${remoteMode(stats)} 0 ${name}\n`));
    await readAck(remote, options);
    const items = await fs.promises.readdir(localPath, { withFileTypes: true });
    for (const item of items) {
      checkCancelled(options);
      const childPath = path.join(localPath, item.name);
      // Follow links like `scp -r` does; a broken link is skipped.
      const childStats = await fs.promises.stat(childPath).catch(() => null);
      if (!childStats) continue;
      await sendEntry(remote, childPath, recordName(item.name), childStats, progress, options);
    }
    await remote.write(Buffer.from('E\n'));
    await readAck(remote, options);
    return;
  }
  if (!stats.isFile()) throw new ScpValidationError('Only regular files and directories can be uploaded');
  await remote.write(Buffer.from(`C${remoteMode(stats)} ${stats.size} ${name}\n`));
  await readAck(remote, options);
  const stream = fs.createReadStream(localPath, { highWaterMark: CHUNK_SIZE });
  try {
    for await (const chunk of stream) {
      checkCancelled(options);
      await remote.write(chunk);
      progress.advance(chunk.length);
    }
  } finally {
    stream.destroy();
  }
  await remote.write(Buffer.from([SCP_ACK]));
  await readAck(remote, options);
}

/** Write one received file to disk, honouring backpressure and cancellation. */
async function receiveFile(remote, destination, record, progress, options) {
  const stream = fs.createWriteStream(destination, { mode: record.mode & 0o777 });
  try {
    await remote.stdout.readInto(record.size, async chunk => {
      checkCancelled(options);
      if (!stream.write(chunk)) await once(stream, 'drain');
      progress.advance(chunk.length);
    });
    stream.end();
    await finished(stream);
  } catch (error) {
    stream.destroy();
    throw error;
  }
  const trailer = await remote.stdout.readByte();
  if (trailer !== SCP_ACK) throw new ScpSessionError('Malformed SCP file trailer');
  await remote.write(Buffer.from([SCP_ACK]));
}

/** Receive one file or directory tree from `scp -f`. */
async function receiveEntry(remote, targetPath, options) {
  for (;;) {
    checkCancelled(options);
    const code = await remote.stdout.readByte();
    if (code === SCP_ACK) return; // end of transfer
    if (code === SCP_WARNING || code === SCP_FATAL) {
      const message = await remote.stdout.readLine();
      if (code === SCP_FATAL) throw new ScpSessionError(message || 'The remote SCP process reported an error');
      if (options.onWarning) options.onWarning(message);
      continue;
    }
    const type = String.fromCharCode(code);
    const line = await remote.stdout.readLine();
    if (type === 'T') {
      await remote.write(Buffer.from([SCP_ACK]));
      continue;
    }
    if (type === 'E') {
      await remote.write(Buffer.from([SCP_ACK]));
      return;
    }
    if (type === 'C') {
      const record = parseRecord(line);
      // The top level keeps the destination chosen by the operator, so the
      // server-side record name is never trusted for the final path.
      const destination = options.useRecordName ? path.join(targetPath, recordName(record.name)) : targetPath;
      await remote.write(Buffer.from([SCP_ACK]));
      await receiveFile(remote, destination, record, options.progress, options);
      continue;
    }
    if (type === 'D') {
      if (!options.recursive) throw new ScpSessionError('The remote entry is a directory; enable recursive mode');
      const record = parseRecord(line);
      const directory = options.useRecordName ? path.join(targetPath, recordName(record.name)) : targetPath;
      await remote.write(Buffer.from([SCP_ACK]));
      await fs.promises.mkdir(directory, { recursive: true });
      await receiveEntry(remote, directory, { ...options, useRecordName: true });
      continue;
    }
    throw new ScpSessionError(`Unexpected SCP record "${type}"`);
  }
}

/** Upload a file or directory through `scp -t` on the bound session. */
async function uploadSessionEntry(tab, localPath, remotePath, options = {}) {
  const source = path.resolve(localPath);
  const destination = String(remotePath || '');
  if (!destination.startsWith('/')) throw new ScpValidationError('Remote path must be absolute (start with /)');
  const parent = posix.dirname(destination);
  const name = recordName(posix.basename(destination));
  const stats = await fs.promises.stat(source);
  const remote = attachChannel(await openExecChannel(tab, `scp -t ${quoteRemotePath(parent)}`));
  const progress = createProgress(options, stats.isFile() ? stats.size : 0);
  try {
    await readAck(remote, options);
    await sendEntry(remote, source, name, stats, progress, options);
    await remote.write(Buffer.from([SCP_ACK]));
    await remote.waitForClose();
    progress.finish();
    const stderr = remote.stderrText;
    if (stderr) throw new ScpSessionError(stderr);
  } finally {
    remote.dispose();
    await remote.close();
  }
}

/** Download a file or directory through `scp -f` on the bound session. */
async function downloadSessionEntry(tab, remotePath, localPath, options = {}) {
  const source = String(remotePath || '');
  if (!source.startsWith('/')) throw new ScpValidationError('Remote path must be absolute (start with /)');
  const target = path.resolve(localPath);
  const recursive = options.recursive === true;
  const command = `scp -f ${recursive ? '-r ' : ''}${quoteRemotePath(source)}`;
  const remote = attachChannel(await openExecChannel(tab, command));
  const progress = createProgress(options, 0);
  try {
    await remote.write(Buffer.from([SCP_ACK]));
    await receiveEntry(remote, target, { ...options, useRecordName: false, recursive, progress });
    await remote.waitForClose();
    progress.finish();
    const stderr = remote.stderrText;
    if (stderr) throw new ScpSessionError(stderr);
  } finally {
    remote.dispose();
    await remote.close();
  }
}

module.exports = {
  ScpSessionError,
  ByteQueue,
  attachChannel,
  openExecChannel,
  runRemoteCommand,
  listSessionDirectory,
  createSessionDirectory,
  moveSessionEntry,
  uploadSessionEntry,
  downloadSessionEntry,
};


