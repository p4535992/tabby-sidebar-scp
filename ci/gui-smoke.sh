#!/usr/bin/env bash
# Disposable Ubuntu runner GUI smoke test for Tabby + SCP (with/without Better Sidebar).
# Produces screenshots, diagnostic logs and a CDP DOM assertion report.
set -Eeuo pipefail
mode="${1:-standalone}"
if [[ "$mode" != standalone && "$mode" != combined ]]; then
    echo "Usage: ci/gui-smoke.sh standalone|combined" >&2
    exit 2
fi

export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1
export ELECTRON_DISABLE_SECURITY_WARNINGS=1
mkdir -p artifacts
echo "$mode" > artifacts/gui-mode.txt

cleanup() {
    set +e
    DISPLAY=:99 scrot -o artifacts/tabby-display.png 2>/dev/null || true
    if [[ -n "${TABBY_PID:-}" ]]; then kill "${TABBY_PID}" 2>/dev/null || true; fi
    if [[ -n "${OPENBOX_PID:-}" ]]; then kill "${OPENBOX_PID}" 2>/dev/null || true; fi
    if [[ -n "${XVFB_PID:-}" ]]; then kill "${XVFB_PID}" 2>/dev/null || true; fi
}
trap cleanup EXIT

Xvfb :99 -screen 0 1440x900x24 -nolisten tcp > artifacts/xvfb.log 2>&1 &
XVFB_PID=$!
for i in $(seq 1 50); do
    if xdpyinfo -display :99 >/dev/null 2>&1; then break; fi
    sleep .2
done
xdpyinfo -display :99 >/dev/null
openbox > artifacts/openbox.log 2>&1 &
OPENBOX_PID=$!

plugin_root="$HOME/.config/tabby/plugins/node_modules"
mkdir -p "$plugin_root"
ln -sfn "$GITHUB_WORKSPACE" "$plugin_root/tabby-sidebar-scp"
test -s "$plugin_root/tabby-sidebar-scp/dist/index.js"

if [[ "$mode" == combined ]]; then
    test -s "$plugin_root/tabby-better-sidebar/dist/index.js"
else
    test ! -e "$plugin_root/tabby-better-sidebar"
fi

binary="$(command -v tabby || true)"
if [[ -z "$binary" ]]; then
    for candidate in /opt/Tabby/tabby /opt/Tabby/Tabby /usr/bin/tabby; do
        if [[ -x "$candidate" ]]; then binary="$candidate"; break; fi
    done
fi
if [[ -z "$binary" ]]; then
    echo "Tabby executable not found after .deb install" >&2
    exit 1
fi

echo "Starting $binary on Xvfb (mode=$mode)"
# Only disposable test keys/hosts are used. no-sandbox is specific to the VM smoke test.
dbus-run-session -- "$binary" --no-sandbox --disable-gpu \
    --disable-dev-shm-usage --remote-debugging-port=9222 \
    --remote-allow-origins='*' > artifacts/tabby.log 2>&1 &
TABBY_PID=$!

# A nonzero exit means the renderer did not load or the expected SCP view
# was not present. This is intentionally stricter than checking only a process.
node ci/probe-tabby.cjs "$mode" | tee artifacts/gui-probe.log
echo "PASS: Tabby GUI and expected SCP integration visible ($mode)"
