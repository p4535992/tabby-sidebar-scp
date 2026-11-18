# Development and integration

This repository is a standalone Tabby plugin; **Better Sidebar is optional**.
The SCP engine does not import Better Sidebar's source code or its npm package.

## Integration decision

Better Sidebar uses its own Angular sidebar, mounted in Tabby's
`.window.h-100.d-flex` window row. The profile/SFTP view bar is
`.sidebar-plus-content .view-mode-bar`. It does not provide a stable API for
external sidebar panels. The `BetterPanelContribution:<id>` interface is
only for co-hosting **settings pages**, not for adding SFTP/SCP views.

`ScpMountService` chooses a placement when Tabby is ready and responds to
subsequent DOM changes:

1. **Better Sidebar view bar found**: insert a third `SCP` anchor with the
   existing `view-mode-tab` class. Append the Angular SCP browser component
   to the sidebar container. When SCP is activated, temporarily hide siblings
   while recording their old display values. Clicking Profiles/SFTP restores
   them; no Better Sidebar components are destroyed or patched.
2. **No compatible view bar**: mount SCP's Angular browser independently as
   a standalone sidebar in Tabby's window row, with its own SCP header.
3. **Placement changes while running**: reparent the same Angular component
   and preserve its browser state.

This is an **optional compatibility shim based on DOM selectors**, not a public
API and not guaranteed across future Better Sidebar/Tabby versions. Its
behavior needs manual testing. If the structure changes but still matches the
selectors, the shim may require an update.

## Operations and process model

- Local file listings use Node `fs.promises.readdir`.
- Remote listings use noninteractive local `ssh`, running a fixed GNU `find`
  command with NUL-separated records. Remote directories require absolute POSIX
  paths; remote GNU `find` is a requirement.
- Remote rename/move uses noninteractive `ssh` to run a fixed
  `test ! -e && test ! -L && mv --` command. Local rename/move uses Node
  `fs.promises.rename` and an existence precheck. These checks can race;
  they are not atomic no-clobber guarantees.
- Copy between local and remote uses **legacy SCP** (`scp -O`), never silently
  replaces SCP with SFTP.
- The default SCP view shows one remote file list, SFTP-style, with filter,
  sorting and Name / Size / Modified columns. Switch to Local or Split for transfers.
- Dragging entries between panes copies; dragging into a directory within a
  pane moves. **A cross-pane copy never deletes its source.**
- There is explicit user confirmation before transfers and moves.
- All spawned commands use `shell: false` on the local machine.
- SSH host-key checking stays strict and authentication is noninteractive.
- No Tabby saved credentials or already-open SSH sessions are accessed.
- `ScpBrowserComponent` owns the transfer task and cancels it on destruction.

## Sources

| File | Role |
| --- | --- |
| `src/index.ts` | Angular plugin module |
| `src/mount.service.ts` | Optional Better Sidebar adapter plus standalone placement |
| `src/scp-browser.component.ts` | SFTP-inspired remote-first, local and split views, drag/drop, transfers and moves |
| `src/scp-browser.js` / `.d.ts` | Local/remote browsing, SSH movement and TypeScript types |
| `src/scp-core.js` / `.d.ts` | SCP argument construction, path validation, transfer lifecycle |
| `src/scp-dialog.component.ts` | Advanced transfer dialog |
| `test/*.test.js` | Mocked backend unit tests |

## Build and unit tests

```bash
npm install --ignore-scripts
npm test
npm run build
```

Only the Node.js backend unit tests are runnable without installing Tabby.
They use a fake SSH/SCP child process and temporary local directories. The
Angular component and compatibility shim still need actual application QA.

## Install an unpublished local build

1. Build the plugin using the commands above.
2. Close Tabby **completely**.
3. Link or install the package in Tabby's plugins directory
   (`node_modules/tabby-sidebar-scp`). Common locations:
   - Windows: `%APPDATA%\tabby\plugins\node_modules`
   - Linux/macOS: `~/.config/tabby/plugins/node_modules`
4. Fully restart Tabby; reloading its window is not sufficient.
5. Verify the SCP panel appears in the appropriate location.

## Manual acceptance checklist

- [ ] Install **without Better Sidebar**: a standalone SCP sidebar with header
      appears, and no Better Sidebar dependency error occurs.
- [ ] Install **with Better Sidebar enabled**: `Profiles | SFTP | SCP` appears.
- [ ] Switch repeatedly between Profiles, SFTP and SCP without losing the
      Better Sidebar tree, active sessions, transfers or SFTP view state.
- [ ] Disable/re-enable Better Sidebar at runtime and confirm that SCP remains
      usable and does not duplicate its header tab.
- [ ] Try Better Sidebar's right-docked SFTP placement.
- [ ] Enter an SSH-config alias, a configured key and a custom port.
- [ ] Verify remote-first UI, path bar, columns, hidden files, filter, sort,
      context menu, collapsed connection settings and Local/Split controls.
- [ ] Browse local/remote folders, including spaces and apostrophes.
- [ ] Upload and download disposable files and folders; verify checksums.
- [ ] Drag a file across panes to copy, and onto a folder in the same pane
      to move; verify the source is only removed for an explicit move.
- [ ] Attempt an existing destination and confirm the warning/behavior.
- [ ] Cancel an active transfer and verify the process terminates.
- [ ] Test missing `scp`, missing `ssh`, no GNU `find`, unknown host key,
      rejected login, and invalid paths.
- [ ] Test with a real Tabby release on each supported desktop OS.

## SFTP toolbar compatibility adapter

SCP's own Angular component implements an SFTP-like toolbar with seven matching
user actions: saved folders, path editing, refresh, filter, directory creation,
file upload and folder upload. It does **not** import SFTPPanelComponent or its
SFTP session; those APIs cannot transfer over the legacy SCP protocol.

Saved remote folders are stored only in Tabby's localStorage under
`tabby-sidebar-scp:remote-favorites:v1`, segregated by host, user and port.
They do not modify Better Sidebar's configuration or SFTP favorites.

Remote folder creation runs `mkdir -- <quoted-absolute-path>` over a new
non-interactive SSH command, refusing an existing path; local folder creation
uses Node fs. File/folder pickers use the optional `@electron/remote` API
provided at runtime by Tabby and gracefully fall back to the Local view.

Run the GitHub Actions smoke tests and inspect screenshots whenever the toolbar
or the upstream Better Sidebar DOM changes. A successful DOM smoke test does
not prove that a user completed a transfer in the actual GUI.

## Compatibility limitations

Do **not** advertise this as a stable Better Sidebar integration until the
manual checklist passes. The DOM adapter is a best-effort bridge. For a stable
extension, Better Sidebar's maintainer would need to expose a documented
public view provider. The independent SCP sidebar will remain as fallback.

## UI consistency with Better Sidebar

The SCP browser uses its own component but follows the Better Sidebar SFTP
layout: header, directory toolbar, filter and file list. Remote is the default;
Local and Split remain available for transfers. See [UI consistency](UI_PARITY.md).
The screenshot of the current toolbar is
[`screenshots/after-sftp-toolbar.webp`](screenshots/after-sftp-toolbar.webp),
captured in [GitHub Actions run #44311878384](https://github.com/p4535992/tabby-sidebar-scp/actions/runs/44311878384).
It shows the toolbar/header without a remote SSH host selected; it is not a
demonstration of a populated remote file listing.
