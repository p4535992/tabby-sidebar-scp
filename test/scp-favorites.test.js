'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFavorites, toggleFavorite, endpointKey, STORAGE_KEY } = require('../src/scp-favorites');

function fakeStorage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}
test('remote folder favorites persist per SSH endpoint', () => {
  const store = fakeStorage();
  const a = { host: 'server', username: 'a' };
  const b = { host: 'server', username: 'b' };
  assert.deepEqual(readFavorites(store, a), []);
  assert.deepEqual(toggleFavorite(store, a, '/home/a'), ['/home/a']);
  assert.deepEqual(readFavorites(store, b), []);
  assert.deepEqual(toggleFavorite(store, a, '/home/a'), []);
});
test('remote folder favorites validate paths and recover malformed storage', () => {
  const store = fakeStorage();
  const conn = { host: 'server' };
  assert.throws(() => toggleFavorite(store, conn, '../tmp'), /absolute/);
  assert.throws(() => toggleFavorite(store, { host: '' }, '/tmp'), /host/);
  store.setItem(STORAGE_KEY, '{');
  assert.deepEqual(readFavorites(store, conn), []);
  store.setItem(STORAGE_KEY, JSON.stringify({ [endpointKey(conn)]: ['/valid', '/bad\\nfile', '/valid'] }));
  assert.deepEqual(readFavorites(store, conn), ['/valid', '/bad\\nfile']);
});
