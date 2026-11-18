'use strict';

// Inspect the actual Electron renderer through Chrome DevTools Protocol.
// Requires Node >= 22 (built-in fetch + WebSocket) and --remote-debugging-port=9222.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const mode = process.argv[2] || 'standalone';
assert(['standalone', 'combined'].includes(mode), 'Expected standalone or combined');
const url = 'http://127.0.0.1:9222/json/list';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let seq = 0;

async function evaluate(target, expression) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        const id = ++seq;
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('CDP evaluation timeout'));
        }, 7000);
        const finish = (error, value) => {
            clearTimeout(timeout);
            try { ws.close(); } catch (_) {}
            if (error) reject(error); else resolve(value);
        };
        ws.addEventListener('open', () => ws.send(JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: true },
        })));
        ws.addEventListener('message', event => {
            let message;
            try { message = JSON.parse(String(event.data)); } catch (_) { return; }
            if (message.id !== id) return;
            if (message.error || message.result?.exceptionDetails) {
                return finish(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
            }
            finish(null, message.result?.result?.value);
        });
        ws.addEventListener('error', () => finish(new Error('CDP WebSocket connection failed')));
    });
}

const stateExpression = String.raw`(() => {
    const browser = document.querySelector('tabby-scp-browser');
    const own = document.querySelector('tabby-scp-browser.scp-standalone');
    const sidebar = document.querySelector('.sidebar-plus-content .view-mode-bar');
    const tab = document.querySelector('[data-tabby-scp-tab]');
    const toolbarButtons = Array.from(document.querySelectorAll('tabby-scp-browser .scp-toolbar [aria-label]'))
        .map(button => button.getAttribute('aria-label'));
    const requiredButtons = [
        'Favorite folders', 'Edit remote path', 'Refresh remote files',
        'Filter the list', 'New remote folder', 'Upload file', 'Upload folder',
    ];
    return {
        toolbarButtons,
        toolbarComplete: requiredButtons.every(label => toolbarButtons.includes(label)),
        remoteTableVisible: !!document.querySelector('tabby-scp-browser [aria-label="Remote files"]'),
        localTableHiddenByDefault: !document.querySelector('tabby-scp-browser [aria-label="Local files"]'),
        permissionsColumnVisible: Array.from(document.querySelectorAll('tabby-scp-browser .scp-file-header'))
            .some(header => header.textContent.includes('Perm.')),
        filterInitiallyCollapsed: !document.querySelector('tabby-scp-browser .scp-filter'),
        viewsInitiallyCollapsed: !document.querySelector('tabby-scp-browser .scp-view-options'),
        title: document.title,
        readyState: document.readyState,
        browser: !!browser,
        standalone: !!own,
        betterHeader: !!sidebar,
        tab: !!tab,
        scpTabActive: !!tab?.classList.contains('active'),
        browserDisplay: browser?.style.display || '',
        browserVisible: !!browser && getComputedStyle(browser).display !== 'none' && !!browser.getClientRects().length,
        modeTabs: Array.from(document.querySelectorAll('.view-mode-tab')).map(el => el.textContent.trim()).slice(0, 8),
    };
})()`;

async function listTargets() {
    const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error('Chrome debug endpoint returned ' + response.status);
    const targets = await response.json();
    return targets.filter(target => !!target.webSocketDebuggerUrl && target.type === 'page');
}

async function waitForRenderedTabby() {
    const deadline = Date.now() + 110000;
    let last = null;
    let attempts = 0;
    while (Date.now() < deadline) {
        try {
            for (const target of await listTargets()) {
                const state = await evaluate(target, stateExpression);
                if (!state) continue;
                last = state;
                const success = mode === 'combined'
                    ? state.browser && state.betterHeader && state.tab
                    : state.browser && state.standalone && !state.betterHeader;
                if (success) return { target, state };
            }
        } catch (e) {
            last = { error: String(e) };
        }
        if (++attempts % 7 === 1) {
            console.log('Waiting for Tabby SCP view:', JSON.stringify(last));
        }
        await sleep(1200);
    }
    throw new Error('Tabby SCP view not found after startup; last state=' + JSON.stringify(last));
}

function captureScreenshot(filename) {
    const result = spawnSync('scrot', ['-o', filename], { encoding: 'utf8' });
    if (result.status !== 0) {
        console.warn('Screenshot capture failed:', result.stderr);
    } else {
        console.log('Screenshot:', filename);
    }
}

async function main() {
    const { target, state } = await waitForRenderedTabby();
    console.log('Initial Tabby renderer state:', JSON.stringify(state));
    assert.equal(state.toolbarComplete, true, 'SFTP-style toolbar is missing controls');
    assert.equal(state.permissionsColumnVisible, true, 'Permissions column is missing');
    assert.equal(state.remoteTableVisible, true, 'Remote file view is missing');
    assert.equal(state.localTableHiddenByDefault, true, 'Local view should not be shown by default');
    assert.equal(state.filterInitiallyCollapsed, true, 'Filename filter must be collapsed by default');
    assert.equal(state.viewsInitiallyCollapsed, true, 'Extra view options must be collapsed by default');
    if (mode === 'combined') {
        const clicked = await evaluate(target, String.raw`(() => {
            const tab = document.querySelector('[data-tabby-scp-tab]');
            if (!tab) return false;
            tab.click();
            return true;
        })()`);
        assert.equal(clicked, true, 'Could not click SCP tab in Better Sidebar');
        await sleep(500);
        const activated = await evaluate(target, stateExpression);
        console.log('After opening SCP tab:', JSON.stringify(activated));
        assert.equal(activated.scpTabActive, true, 'SCP tab did not become active');
        assert.equal(activated.browserVisible, true, 'SCP browser did not become visible');
        captureScreenshot('artifacts/tabby-scp-active.png');

        const restored = await evaluate(target, String.raw`(() => {
            const original = document.querySelector('.view-mode-tab:not([data-tabby-scp-tab])');
            if (!original) return false;
            original.click();
            return true;
        })()`);
        assert.equal(restored, true, 'No original Better Sidebar tab found');
        await sleep(250);
        const postRestore = await evaluate(target, stateExpression);
        console.log('After returning to original tab:', JSON.stringify(postRestore));
        assert.equal(postRestore.scpTabActive, false, 'SCP remained selected after original tab click');
    } else {
        assert.equal(state.browserVisible, true, 'Standalone SCP sidebar is hidden');
        captureScreenshot('artifacts/tabby-scp-active.png');
    }

    fs.writeFileSync('artifacts/gui-result.json', JSON.stringify({
        mode,
        passed: true,
        firstState: state,
        verifiedAt: new Date().toISOString(),
    }, null, 2));
    console.log('PASS: renderer, SCP view and switching assertions');
}

main().catch(error => {
    console.error('GUI smoke test failed:', error);
    fs.writeFileSync('artifacts/gui-result.json', JSON.stringify({
        mode,
        passed: false,
        message: String(error),
        verifiedAt: new Date().toISOString(),
    }, null, 2));
    process.exitCode = 1;
});
