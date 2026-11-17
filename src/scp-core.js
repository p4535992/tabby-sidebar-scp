'use strict';

/**
 * Backend independent from Tabby and Better Sidebar.
 * OpenSSH's -O option is essential: scp without -O can use SFTP.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const HOST_NAME = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;
const IPV6_HOST = /^\[[0-9a-fA-F:.%]+\]$/;
const USER_NAME = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

class ScpValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScpValidationError';
  }
}

function stringField(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ScpValidationError(`${fieldName} is required`);
  }
  if (CONTROL_CHARS.test(value)) {
    throw new ScpValidationError(`${fieldName} contains control characters`);
  }
  return value.trim();
}

function resolveLocalPath(value, fieldName) {
  const given = stringField(value, fieldName);
  const expanded = given === '~' ? os.homedir()
    : given.startsWith('~/') || given.startsWith('~\\')
      ? path.join(os.homedir(), given.slice(2))
      : given;
  return path.resolve(expanded);
}

/** A POSIX shell token for the legacy SCP remote-shell command (not for a local shell). */
function quoteRemotePath(value) {
  const remotePath = stringField(value, 'Remote path');
  if (!remotePath.startsWith('/')) {
    throw new ScpValidationError('Remote path must be absolute (start with /)');
  }
  return `'${remotePath.replace(/'/g, `'\\''`)}'`;
}

function parsePort(value) {
  if (value == null || value === '') return null; // use port from SSH config/default
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new ScpValidationError('Port must be an integer from 1 to 65535');
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 1 || n > 65535) {
    throw new ScpValidationError('Port must be an integer from 1 to 65535');
  }
  return n;
}

/**
 * Construct an argv vector; DO NOT pass this through a local shell or join it
 * into a string passed to exec(). The remote path is quoted for scp -O's remote
 * POSIX shell, while host/user are restricted to non-shell metacharacters.
 */
function buildScpCommand(input) {
  if (!input || (input.direction !== 'upload' && input.direction !== 'download')) {
    throw new ScpValidationError('Direction must be upload or download');
  }
  const host = stringField(input.host, 'Host');
  if (!(HOST_NAME.test(host) || IPV6_HOST.test(host)) || host.length > 253) {
    throw new ScpValidationError('Host must be a safe SSH host or config alias');
  }

  const user = input.username == null || input.username === ''
    ? '' : stringField(input.username, 'Username');
  if (user && !USER_NAME.test(user)) {
    throw new ScpValidationError('Username contains unsupported characters');
  }

  const port = parsePort(input.port);
  const localPath = resolveLocalPath(input.localPath, 'Local path');
  const remotePath = stringField(input.remotePath, 'Remote path');
  const remoteSpec = `${user ? `${user}@` : ''}${host}:${quoteRemotePath(remotePath)}`;
  const args = [
    '-O', // force legacy SCP protocol, never silently fall back to SFTP
    '-B', // disable interactive prompts in the GUI
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=15',
  ];
  if (port != null) args.push('-P', String(port));

  if (input.identityFile) {
    args.push('-i', resolveLocalPath(input.identityFile, 'Identity file'));
  }
  if (input.recursive) args.push('-r');
  if (input.preserveTimes) args.push('-p');
  if (input.compress) args.push('-C');

  if (input.direction === 'upload') {
    args.push(localPath, remoteSpec);
  } else {
    args.push(remoteSpec, localPath);
  }
  return { executable: 'scp', args, localPath, remoteSpec };
}

/** Check filesystem prerequisites without contacting a remote host. */
function checkLocalPaths(input, command, fileSystem = fs) {
  if (input.identityFile) {
    const identity = resolveLocalPath(input.identityFile, 'Identity file');
    try {
      if (!fileSystem.statSync(identity).isFile()) throw new Error('not a file');
    } catch {
      throw new ScpValidationError('Identity file does not exist: ' + identity);
    }
  }
  let localStat;
  try {
    localStat = fileSystem.statSync(command.localPath);
  } catch (err) {
    if (input.direction === 'upload') {
      throw new ScpValidationError('Upload source does not exist: ' + command.localPath);
    }
    const parent = path.dirname(command.localPath);
    try {
      if (!fileSystem.statSync(parent).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new ScpValidationError('Download destination parent is not a directory: ' + parent);
    }
    return;
  }

  if (input.direction === 'upload') {
    if (!localStat.isFile() && !localStat.isDirectory()) {
      throw new ScpValidationError('Upload source must be a regular file or directory');
    }
    if (localStat.isDirectory() && !input.recursive) {
      throw new ScpValidationError('Enable recursive mode to upload a directory');
    }
  } else if (!localStat.isFile() && !localStat.isDirectory()) {
    throw new ScpValidationError('Download destination must be a file or directory');
  }

}

/**
 * Start one explicit SCP transfer. The caller owns the returned task and can
 * cancel it. Callback receives stdout/stderr text; it never uses a shell.
 * The injectable spawn function exists exclusively for deterministic tests.
 */
function startScpTransfer(input, onOutput = () => {}, dependencies = {}) {
  const command = buildScpCommand(input);
  checkLocalPaths(input, command, dependencies.fs || fs);
  const startProcess = dependencies.spawn || spawn;
  const child = startProcess(command.executable, command.args, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cancelled = false;
  let settled = false;

  const completed = new Promise(resolve => {
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    if (child.stdout) {
      child.stdout.on('data', data => onOutput(String(data), 'stdout'));
    }
    if (child.stderr) {
      child.stderr.on('data', data => onOutput(String(data), 'stderr'));
    }
    child.once('error', error => {
      finish({ ok: false, cancelled, exitCode: null, error: error.message });
    });
    child.once('close', (code, signal) => {
      finish({
        ok: !cancelled && code === 0,
        cancelled,
        exitCode: code,
        signal,
        error: cancelled ? 'Transfer cancelled' : code === 0 ? '' : `scp exited with code ${code ?? 'unknown'}`,
      });
    });
  });

  return {
    completed,
    cancel() {
      if (settled || cancelled) return false;
      cancelled = true;
      return child.kill();
    },
  };
}

module.exports = {
  ScpValidationError,
  buildScpCommand,
  checkLocalPaths,
  parsePort,
  quoteRemotePath,
  startScpTransfer,
};
