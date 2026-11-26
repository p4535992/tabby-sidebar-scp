# Changelog

All notable changes to this project are documented here. Release identifiers are
numeric semantic versions **without a `v` prefix**.

## [Unreleased]

## [0.1.2] - 2026-11-26

### Added
- A **SCP Sidebar** page in Tabby's Settings tab with an *Enable the SCP file
  browser* switch (`scpSidebar.enabled`): the panel is removed or re-created at
  runtime, without restarting Tabby or unloading the plugin.
- Automatic binding to the focused SSH tab, split panes included: remote
  listings, folder creation, rename/move and recursive upload/download now run
  on that session, so Tabby's saved password or key is reused and no
  host/user/port/key has to be entered again.
- Transfers speak the **legacy SCP protocol** (`scp -t` / `scp -f`) on an exec
  channel of the bound connection: no SFTP subsystem is needed on the server and
  no local `scp`/`ssh` process is started.
- Session bar shows the bound tab; the badge reads `SCP` with a tooltip that
  distinguishes the session path from the local OpenSSH client, and the initial
  remote directory is the shell's reported working directory when available.

### Changed
- The local OpenSSH `scp -O` path is now an explicit manual fallback, used only
  while no SSH session is open.
- Remote folder favorites are keyed by the bound session's host/user/port.
- The remote move command now reports a refused overwrite on stderr, so the
  session path (which has no exit status) surfaces the same error as the manual
  path.

See [0.1.2 release notes](docs/releases/0.1.2.md).

## [0.1.1] - 2026-11-18

Second GitHub release, packaging the SFTP-style SCP sidebar improvements.

### Added
- Seven-button remote toolbar matching Better Sidebar's SFTP conventions:
  favorite folders, edit path, refresh, filter, create remote folder, upload
  file, and upload folder.
- Remote folder favorites persisted per SSH connection (host/user/port), without
  sharing settings with Better Sidebar.
- Remote directory creation over noninteractive SSH, and native picker actions
  for file/folder uploads where Tabby's Electron APIs are available.

### Changed
- SFTP-inspired remote-first file listing, breadcrumbs, columns and contextual
  file actions, while retaining standalone, Local and Split modes.
- README and documentation now highlight the current UI instead of obsolete
  comparison screenshots.
- GitHub Actions VM tests cover the toolbar and both Tabby layout modes.

### Limitations
- Manual drag-and-drop and native picker interactions are not covered by the
  automated renderer smoke tests.
- Better Sidebar integration remains a best-effort DOM compatibility adapter.

See [0.1.1 release notes](docs/releases/0.1.1.md).

## [0.1.0] - 2026-11-18

First public GitHub release.

### Added
- Independent SCP sidebar for Tabby, with an optional **SCP** tab alongside
  Better Sidebar's Profiles and SFTP views.
- Remote-first file browser with optional local and split views, folder
  navigation, search/filter, sorting, and file metadata.
- Upload and download with OpenSSH legacy `scp -O`; remote SSH listing and
  move/rename, local move/rename, copy and drag-and-drop controls.
- Safety checks for file operations; a separate explicit opt-in for complex
  remote download names requiring `scp -T`.
- GitHub Actions tests on temporary Ubuntu VMs: unit tests, real loopback
  SSH/SCP transfers, and UI smoke tests with and without Better Sidebar.

### Known limitations
- Better Sidebar integration uses DOM selectors rather than a supported API.
- Full manual drag-and-drop and cross-platform UI testing are still required.
- Uses local OpenSSH credentials, not passwords or sessions saved inside Tabby.

See [release notes](docs/releases/0.1.0.md) and
[UI consistency notes](docs/UI_PARITY.md).
