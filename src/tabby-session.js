'use strict';

/**
 * Resolve the SSH tab the operator is working in, without importing
 * `tabby-ssh`. A plugin bundle can end up with a second copy of `tabby-ssh`,
 * whose classes are different objects: an `instanceof SSHTabComponent` check
 * then fails silently on tabs that plainly are SSH tabs. Duck typing on the
 * session objects survives that, and keeps this plugin free of a dependency
 * on tabby-ssh.
 */

/** A tab is an SSH tab when it carries Tabby's SSH session object. */
function isSshTab(tab) {
  const session = tab && tab.sshSession;
  if (!session || typeof session !== 'object') return false;
  return typeof session.openSFTP === 'function' || (typeof session.ssh === 'object' && session.ssh !== null);
}

/**
 * A tab is live when its shell session still exists and the SSH client can open
 * exec channels. `sshSession.open` is not enough: Tabby never clears that flag
 * when the connection drops, while it does null out `session` when the shell ends.
 */
function isLiveSshTab(tab) {
  if (!isSshTab(tab)) return false;
  const session = tab.sshSession;
  if (session.open === false || !tab.session) return false;
  const client = session.ssh;
  return !!client && typeof client.openSessionChannel === 'function' && typeof client.activateChannel === 'function';
}

/** The focused tab, descending into a split tab's focused pane. */
function focusedTab(app) {
  let tab = app && app.activeTab;
  if (tab && typeof tab.getFocusedTab === 'function') {
    const focused = tab.getFocusedTab();
    if (focused) tab = focused;
  }
  return tab || null;
}

/** The active SSH tab, or null when the operator is not in an SSH session. */
function resolveActiveSshTab(app) {
  const tab = focusedTab(app);
  return isLiveSshTab(tab) ? tab : null;
}

/** Human readable name for the session bar. */
function sessionLabel(tab) {
  if (!tab) return '';
  const profile = tab.profile || tab._profile || null;
  const parentTitle = tab.topmostParent && tab.topmostParent.customTitle;
  return tab.customTitle || parentTitle || (profile && profile.name) || tab.title || 'SSH session';
}

/** `user@host:port` when the profile exposes it; empty otherwise. */
function sessionEndpoint(tab) {
  const profile = tab && (tab.profile || tab._profile);
  const options = (profile && profile.options) || {};
  const host = typeof options.host === 'string' ? options.host.trim() : '';
  if (!host) return '';
  const user = typeof options.user === 'string' && options.user ? options.user + '@' : '';
  const port = options.port && Number(options.port) !== 22 ? ':' + options.port : '';
  return user + host + port;
}

module.exports = {
  isSshTab,
  isLiveSshTab,
  focusedTab,
  resolveActiveSshTab,
  sessionLabel,
  sessionEndpoint,
};
