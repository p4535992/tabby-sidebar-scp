# tabby-sidebar-scp

Standalone **SCP file transfer plugin for Tabby**. Install it alongside
[tabby-better-sidebar](https://github.com/TooMuhtsh/tabby-better-sidebar)
without changing or replacing the original Better Sidebar plugin.

> **Status: initial version / MVP.** The Node.js transfer engine has unit tests.
> The Tabby toolbar/dialog integration still requires a real Tabby installation
> test before this is advertised as production-ready.

## Why a separate plugin?

The existing Better Sidebar settings contract (`BetterPanelContribution:<id>`)
is for shared **settings pages**. It is not a documented extension point for
injecting a new file-manager panel inside Better Sidebar. To avoid a fragile
dependency on internal components, this plugin opens its own SCP transfer dialog
from a Tabby toolbar button. Better Sidebar can remain installed and unchanged.

This is a **transfer dialog, not the SCP file browser** from the experimental
`feature/optional-scp-panel` fork. It does not provide remote directory
navigation, drag-and-drop, or reuse an existing Tabby SSH session.

## Supported operations

- Upload a local file to a remote path.
- Download a remote file to a local path.
- Optional recursive copy of directories (`-r`).
- Optional timestamp preservation (`-p`) and compression (`-C`).
- SSH host or `~/.ssh/config` alias, optional username, port and identity key.
- Output/status log and transfer cancellation.
- Manual confirmation before starting a potentially overwriting transfer.

### Protocol and security

This plugin invokes local OpenSSH `scp -O`, forcing **legacy SCP**, which is
different from SFTP (the default protocol of newer OpenSSH `scp` clients).
It uses process arguments with `shell: false`, validates host/user/port,
and quotes absolute POSIX remote paths for the legacy remote shell.

The process operates in noninteractive batch mode. Host-key checking remains
enabled. The plugin **does not read saved Tabby passwords, SSH profiles, or
active connections**. Configure key/agent authentication and trusted host keys
for local OpenSSH in advance. Only transfer files to trusted SSH servers.
An SCP transfer may overwrite files; always double-check both paths.

## Requirements

- A plugin-compatible Tabby release (initial target: Tabby 1.0.231+).
- Local `scp` executable with support for `-O` and access to an SSH server
  that supports the legacy SCP protocol.
- Working key or ssh-agent authentication; host in `known_hosts`.
- Absolute remote paths beginning with `/` (POSIX-style).

## Develop and test

```bash
npm install --ignore-scripts
npm test
npm run build
```

To test locally, build the plugin and install/link the built package into
Tabby's plugin directory. Fully restart Tabby. This package has not been
published to npm; see [the developer guide](docs/DEVELOPMENT.md).

The unit tests do not contact any SSH server. To validate operation, test
upload/download against a disposable SSH host and confirm the original
Better Sidebar's controls still work.

## Project files

- `src/scp-core.js`: SCP process and safe argument builder
- `src/scp-core.d.ts`: TypeScript declarations
- `src/index.ts`: Tabby module and toolbar action
- `src/scp-dialog.component.ts`: transfer dialog
- `test/scp-core.test.js`: backend unit tests
- `docs/DEVELOPMENT.md`: installation and manual QA guide

## License

MIT.
