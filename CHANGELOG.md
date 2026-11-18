# Changelog

All notable changes to this project are documented here. Release identifiers are
numeric semantic versions **without a `v` prefix**.

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
