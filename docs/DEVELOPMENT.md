# Developer guide / Guida allo sviluppo

## Architecture

This repository is an independent **Tabby SCP companion plugin**. It does not
modify `tabby-better-sidebar`, replace Tabby's native sidebar, or patch
another plugin's private Angular components/DOM.

The first release exposes a Tabby toolbar action opening a transfer dialog.
Better Sidebar's `BetterPanelContribution:<id>` contract concerns shared
settings pages, **not** file-browser component injection. A native-looking
in-sidebar SCP panel will require a documented integration API from the
maintainer or a separate compatibility layer, neither of which exists here.

## Code layout

| Path | Description |
|---|---|
| `src/index.ts` | Angular module and Tabby toolbar button |
| `src/scp-dialog.component.ts` | Transfer UI, confirmation, logs and cancellation |
| `src/scp-core.js` | Node/OpenSSH argv and child-process lifecycle |
| `src/scp-core.d.ts` | TypeScript declarations for the core |
| `test/scp-core.test.js` | Unit tests, no external SSH needed |

## Local checks

```bash
node --version      # Node 18+ is recommended
npm install --ignore-scripts
npm test
npm run build
```

`npm test` exercises the SCP engine with mocked processes/filesystem.
Passing tests **does not prove** that the UI loads in a specific version of
Tabby or that a remote host supports legacy SCP.

The bundled Angular and Tabby SDK packages are build-time dependencies.
Webpack externalizes them so Tabby's own modules are used at runtime.
`dist/index.js` is the plugin entry point.

## Install an unpublished build in Tabby

1. Run `npm run build`.
2. Close Tabby completely.
3. Install or link the plugin folder under Tabby's plugins `node_modules`.
4. Fully restart Tabby (reloading only the window may not reload plugins).
5. Verify the SCP toolbar action appears and opens the dialog.

Typical plugin directories (verify for your Tabby installation):
- Windows: `%APPDATA%\tabby\plugins\node_modules`
- Linux: `~/.config/tabby/plugins/node_modules`
- macOS: `~/.config/tabby/plugins/node_modules`

Another option for a local package is `npm pack` (build first) and install
the resulting `.tgz` locally. This does not publish to npm.

## Manual acceptance checklist

- [ ] Install alongside **unmodified** `tabby-better-sidebar`; its
      profile tree, SFTP panel and settings still work.
- [ ] Verify the toolbar button and modal load without console exceptions.
- [ ] Use a host alias with User/Port from `~/.ssh/config`.
- [ ] Upload a disposable file and verify checksum/content on the server.
- [ ] Download a disposable file and verify checksum/content locally.
- [ ] Upload and download a directory with `-r`.
- [ ] Verify remote paths with spaces and an apostrophe.
- [ ] Test cancellation during a large copy.
- [ ] Test invalid ports, missing local files/keys and an unknown host key.
- [ ] Check that errors are visible and never silently ignored.
- [ ] Restart Tabby and repeat.

## Security boundaries and limitations

- Native `scp` is spawned with an argument array; no local shell.
- `-O` explicitly requests **legacy SCP**, not modern SFTP-based scp.
- `-B`, `BatchMode=yes` and strict host key checking disable
  hidden prompts and unexpected host-key acceptance.
- Remote absolute paths are quoted for the POSIX shell expected by SCP.
- Username and host values reject shell metacharacters and option injection.
- User confirmation is required for each transfer; existing files can be
  overwritten by SCP. No collision detection is offered.
- Saved Tabby credentials and active SSH sessions are not read.
- An SCP server must support legacy SCP; SFTP-only servers will fail.
- Windows paths, compatibility with a real Tabby build and third-party plugins
  have **not** yet been tested end to end.

## Future enhancement

If Better Sidebar introduces an official extension point for new sidebar
panels, add an *optional adapter* gated by API version. The standalone dialog
should remain available even when Better Sidebar is not installed. Never
depend on internal selectors or undocumented component instances.
