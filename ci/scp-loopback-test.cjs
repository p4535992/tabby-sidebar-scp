'use strict';

// End-to-end loopback test: exercises real openssh-server, ssh, and scp -O
// on an ephemeral GitHub Actions VM. No saved credentials or public hosts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { startScpTransfer } = require('../src/scp-core');
const { listRemoteDirectory, moveRemoteEntry } = require('../src/scp-browser');

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function transfer(options) {
    const chunks = [];
    const task = startScpTransfer(options, (text, stream) => chunks.push([stream, text]));
    const result = await task.completed;
    assert.equal(result.ok, true, 'SCP operation failed: ' + result.error + '\nOpenSSH output: ' + JSON.stringify(chunks));
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-scp-vm-'));
    const local = path.join(root, 'local');
    const remote = path.join(root, 'remote');
    const output = path.join(root, 'download');
    fs.mkdirSync(local);
    fs.mkdirSync(remote);
    fs.mkdirSync(output);

    const keyFile = path.join(os.homedir(), '.ssh', 'tabby-ci-key');
    const connection = {
        host: '127.0.0.1',
        username: os.userInfo().username,
        port: 2222,
        identityFile: keyFile,
    };
    const name = "sample's file with spaces.txt";
    const source = path.join(local, name);
    const copied = path.join(remote, name);
    const renamed = path.join(remote, 'renamed-file.txt');
    const downloaded = path.join(output, 'downloaded.txt');
    fs.writeFileSync(source, 'SCP CI test: accented à, spaces and apostrophe.\n');

    try {
        await transfer({ ...connection, direction: 'upload', localPath: source, remotePath: copied });
        assert.equal(hash(source), hash(copied), 'Uploaded bytes changed');
        console.log('PASS: upload (SCP legacy protocol) and SHA-256');

        const listing = await listRemoteDirectory(connection, remote);
        assert(listing.entries.some(entry => entry.name === name));
        console.log('PASS: remote directory listing over SSH');

        await moveRemoteEntry(connection, copied, renamed);
        assert.equal(fs.existsSync(copied), false, 'Old remote path still exists');
        assert.equal(hash(renamed), hash(source));
        console.log('PASS: remote move/rename over SSH');

        await transfer({ ...connection, direction: 'download', localPath: downloaded, remotePath: renamed });
        assert.equal(hash(source), hash(downloaded), 'Downloaded bytes changed');
        console.log('PASS: download (SCP legacy protocol) and SHA-256');

        // Only this ephemeral trusted loopback server is allowed to use -T.
        fs.copyFileSync(renamed, copied);
        const complexDownload = path.join(output, 'complex-download.txt');
        await transfer({ ...connection, direction: 'download',
            localPath: complexDownload, remotePath: copied,
            allowUnverifiedRemoteNames: true });
        assert.equal(hash(source), hash(complexDownload));
        console.log('PASS: explicit -T download for complex legacy name');

        await assert.rejects(() => moveRemoteEntry(connection, renamed, downloaded), /./);
        console.log('PASS: remote move refuses existing destination');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
