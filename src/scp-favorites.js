'use strict';
const { quoteRemotePath } = require('./scp-core');
const STORAGE_KEY = 'tabby-sidebar-scp:remote-favorites:v1';
const MAX_FAVORITES = 100;

function endpointKey(connection) {
  if (!connection || typeof connection.host !== 'string' || !connection.host.trim()) return '';
  return JSON.stringify([
    connection.host.trim().toLowerCase(),
    String(connection.username || '').trim(),
    String(connection.port || '').trim(),
  ]);
}

function cleanFavorites(value) {
  if (!Array.isArray(value)) return [];
  const paths = [];
  for (const item of value) {
    if (typeof item !== 'string' || paths.includes(item)) continue;
    try { quoteRemotePath(item); paths.push(item); } catch (_) { /* Ignore invalid persisted paths. */ }
    if (paths.length === MAX_FAVORITES) break;
  }
  return paths;
}

function readCollection(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw && JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}

function readFavorites(storage, connection) {
  const key = endpointKey(connection);
  return key ? cleanFavorites(readCollection(storage)[key]) : [];
}

function toggleFavorite(storage, connection, remotePath) {
  quoteRemotePath(remotePath);
  const key = endpointKey(connection);
  if (!key) throw new Error('Select an SSH host before managing favorites');
  if (!storage || typeof storage.setItem !== 'function') throw new Error('Local settings storage is unavailable');
  const data = readCollection(storage);
  const current = cleanFavorites(data[key]);
  const updated = current.includes(remotePath) ? current.filter(x => x !== remotePath)
    : [...current, remotePath].slice(-MAX_FAVORITES);
  data[key] = updated;
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
  return updated;
}
module.exports = { STORAGE_KEY, endpointKey, readFavorites, toggleFavorite };
