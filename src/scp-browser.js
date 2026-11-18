'use strict';

/** Minimal file browsing over local fs and a noninteractive SSH session.
 * Only the transfers themselves use the legacy SCP protocol.
 */
const fs = require('node:fs');
const path = require('node:path');
const posix = path.posix;
const { spawn } = require('node:child_process');
const { validateConnection, quoteRemotePath, resolveLocalPath, ScpValidationError } = require('./scp-core');

const MAX_LIST_BYTES = 2 * 1024 * 1024;

function joinRemoteDirectory(directory, name) {
  quoteRemotePath(directory);
  if (typeof name !== 'string' || !name || name === '.' || name === '..'
      || name.includes('/') || /[\x00-\x1f\x7f]/.test(name)) {
    throw new ScpValidationError('Invalid remote entry name');
  }
  return posix.join(directory, name);
}

function parentRemoteDirectory(directory) {
  quoteRemotePath(directory);
  return posix.dirname(directory);
}

function buildSshCommand(input, command) {
  const { endpoint, port, identityFile } = validateConnection(input);
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=15'];
  if (port !== null) args.push('-p', String(port));
  if (identityFile) args.push('-i', identityFile);
  args.push(endpoint, command);
  return { executable: 'ssh', args };
}

function buildListCommand(input, directory) {
  const quotedDirectory = quoteRemotePath(directory);
  // GNU find emits type/name/size/mtime/mode with NUL records.
  // File names containing tabs or control characters remain unsupported.
  const command = String.raw`LC_ALL=C find -- ${quotedDirectory} -mindepth 1 -maxdepth 1 -printf '%y\t%f\t%s\t%T@\t%m\0'`;
  return buildSshCommand(input, command);
}

function buildMoveCommand(input, from, to) {
  const source = quoteRemotePath(from);
  const destination = quoteRemotePath(to);
  if (from === to || to.startsWith(from + '/')) {
    throw new ScpValidationError('Move destination must be different and outside source');
  }
  // Refuse overwrites by default. -L catches a dangling symlink at destination.
  const command = `test ! -e ${destination} && test ! -L ${destination} && mv -- ${source} ${destination}`;
  return buildSshCommand(input, command);
}

function runSsh(input, command, dependencies = {}) {
  const start = dependencies.spawn || spawn;
  const child = start(command.executable, command.args, {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  });
  const chunks = [];
  const errors = [];
  let bytes = 0;
  let tooLarge = false;
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = error => {
      if (done) return;
      done = true;
      reject(error);
    };
    child.stdout?.on('data', chunk => {
      const item = Buffer.from(chunk);
      bytes += item.length;
      if (bytes > MAX_LIST_BYTES) {
        tooLarge = true;
        child.kill();
      } else {
        chunks.push(item);
      }
    });
    child.stderr?.on('data', chunk => {
      if (Buffer.concat(errors).length < 8192) errors.push(Buffer.from(chunk));
    });
    child.once('error', fail);
    child.once('close', code => {
      if (tooLarge) return fail(new Error('SSH result is too large; open a smaller directory'));
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString('utf8').trim();
        return fail(new Error(detail || `ssh exited with code ${code ?? 'unknown'}`));
      }
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

function parseRemoteEntries(buffer, directory) {
  const entries = [];
  const records = buffer.toString('utf8').split('\0');
  if (records.pop() !== '') throw new Error('Malformed remote file listing');
  for (const record of records) {
    if (!record) continue;
    const fields = record.split('\t');
    if (fields.length !== 5 || fields[0].length !== 1) {
      throw new Error('Malformed remote file listing');
    }
    const [kind, name, rawSize, rawTime, mode] = fields;
    const size = Number(rawSize);
    const modifiedAt = Number(rawTime) * 1000;
    if (!Number.isFinite(size) || size < 0 || !Number.isFinite(modifiedAt)
      || !/^[0-7]{3,4}$/.test(mode)) {
      throw new Error('Malformed remote file metadata');
    }
    // Reject unsupported names: UI uses single-path SCP transfers.
    const entryPath = joinRemoteDirectory(directory, name);
    entries.push({ name, path: entryPath, isDirectory: kind === 'd', isSymbolicLink: kind === 'l',
      size, modifiedAt, mode });
  }
  return sortEntries(entries);
}

function sortEntries(entries) {
  return entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory)
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

async function listLocalDirectory(directory, fileSystem = fs) {
  const resolved = resolveLocalPath(directory, 'Local directory');
  const listing = await fileSystem.promises.readdir(resolved, { withFileTypes: true });
  return {
    directory: resolved,
    entries: sortEntries(await Promise.all(listing.map(async item => {
      const fullPath = path.join(resolved, item.name);
      const stats = await fileSystem.promises.lstat(fullPath);
      return {
        name: item.name, path: fullPath,
        isDirectory: item.isDirectory(), isSymbolicLink: item.isSymbolicLink(),
        size: stats.size, modifiedAt: stats.mtimeMs, mode: (stats.mode & 0o777).toString(8),
      };
    }))),
  };
}

async function listRemoteDirectory(input, directory, dependencies) {
  const command = buildListCommand(input, directory);
  const output = await runSsh(input, command, dependencies);
  return { directory, entries: parseRemoteEntries(output, directory) };
}

async function moveRemoteEntry(input, source, destination, dependencies) {
  const command = buildMoveCommand(input, source, destination);
  await runSsh(input, command, dependencies);
}

async function moveLocalEntry(source, destination, fileSystem = fs) {
  const from = resolveLocalPath(source, 'Source');
  const to = resolveLocalPath(destination, 'Destination');
  if (from === to || to.startsWith(from + path.sep)) {
    throw new ScpValidationError('Move destination must be different and outside source');
  }
  // Do not use fs.rename until we've checked whether a destination exists.
  try {
    await fileSystem.promises.lstat(to);
    throw new ScpValidationError('Destination already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fileSystem.promises.rename(from, to);
}

module.exports = {
  buildSshCommand, buildListCommand, buildMoveCommand,
  listLocalDirectory, listRemoteDirectory, moveLocalEntry, moveRemoteEntry,
  parseRemoteEntries, joinRemoteDirectory, parentRemoteDirectory,
};
