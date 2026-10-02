import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence, STORAGE_KEY, RECOVERY_KEY } from './storage.js';

const normalize = (value) =>
  value && typeof value === 'object' && 'value' in value ? value : null;
const originals = {};

function setGlobal(name, value) {
  originals[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function setup(initial = null, { failGet, failSet } = {}) {
  const values = new Map();
  if (initial !== null) values.set(STORAGE_KEY, initial);
  const store = {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    getItem(key) {
      if (failGet?.(key)) throw new Error('read failed');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (failSet?.(key)) throw new Error('write failed');
      values.set(key, String(value));
    },
  };
  const locks = { request: (_name, _options, callback) => Promise.resolve(callback()) };
  setGlobal('localStorage', store);
  setGlobal('navigator', { locks });
  setGlobal('window', undefined);
  return { values, store, locks };
}

function cleanup() {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  for (const name of Object.keys(originals)) delete originals[name];
}

test('preserves corrupt raw data and exposes a separate recovery copy', async () => {
  const raw = '{broken json';
  const { values } = setup(raw);
  try {
    const persistence = createPersistence(normalize);
    assert.equal(persistence.load(), null);
    assert.equal(values.get(STORAGE_KEY), raw);
    assert.equal(values.get(RECOVERY_KEY), raw);
    assert.equal(persistence.getRecovery(), raw);
    assert.equal(await persistence.save({ value: 1 }), true);
    assert.equal(values.get(STORAGE_KEY), JSON.stringify({ value: 1 }));
    persistence.dispose();
  } finally {
    cleanup();
  }
});

test('recovery backup failure never replaces the corrupt source', async () => {
  const raw = 'not json';
  const { values } = setup(raw, { failSet: (key) => key === RECOVERY_KEY });
  try {
    const persistence = createPersistence(normalize);
    assert.equal(persistence.load(), null);
    assert.equal(values.get(STORAGE_KEY), raw);
    assert.equal(values.has(RECOVERY_KEY), false);
    assert.equal(persistence.getRecovery(), raw);
    assert.equal(await persistence.save({ value: 2 }), false);
    persistence.dispose();
  } finally {
    cleanup();
  }
});

test('CAS conflict preserves the other tab value and stops later saves', async () => {
  const initial = JSON.stringify({ value: 1 });
  const { values } = setup(initial);
  try {
    const statuses = [];
    const persistence = createPersistence(normalize, {
      onStatus: (status) => statuses.push(status),
    });
    assert.deepEqual(persistence.load(), { value: 1 });
    const otherTab = JSON.stringify({ value: 8 });
    values.set(STORAGE_KEY, otherTab);
    assert.equal(await persistence.save({ value: 2 }), false);
    assert.equal(values.get(STORAGE_KEY), otherTab);
    assert.match(statuses.at(-1), /存档冲突/);
    assert.equal(await persistence.save({ value: 3 }), false);
    persistence.dispose();
  } finally {
    cleanup();
  }
});

test('queued saves commit in invocation order and advance their expected raw value', async () => {
  setup(null);
  try {
    const persistence = createPersistence(normalize);
    assert.equal(persistence.load(), null);
    const first = persistence.save({ value: 'older' });
    const second = persistence.save({ value: 'newer' });
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(localStorage.getItem(STORAGE_KEY), JSON.stringify({ value: 'newer' }));
    persistence.dispose();
  } finally {
    cleanup();
  }
});

test('storage read failures disable saves without replacing existing data', async () => {
  const raw = JSON.stringify({ value: 4 });
  let failRead = false;
  const { values } = setup(raw, { failGet: (key) => failRead && key === STORAGE_KEY });
  try {
    const persistence = createPersistence(normalize);
    assert.deepEqual(persistence.load(), { value: 4 });
    failRead = true;
    assert.equal(await persistence.save({ value: 5 }), false);
    assert.equal(values.get(STORAGE_KEY), raw);
    persistence.dispose();
  } finally {
    cleanup();
  }
});

test('reload invalidates queued saves from the previous draft', async () => {
  const { values } = setup(JSON.stringify({ value: 1 }));
  try {
    const p = createPersistence(normalize);
    p.load();
    const pending = p.save({ value: 'old draft' });
    values.set(STORAGE_KEY, JSON.stringify({ value: 'new external' }));
    assert.deepEqual(p.reload(), { value: 'new external' });
    assert.equal(await pending, false);
    assert.equal(values.get(STORAGE_KEY), JSON.stringify({ value: 'new external' }));
    p.dispose();
  } finally {
    cleanup();
  }
});
test('successive corrupt payloads retain every original recovery copy', () => {
  const { values } = setup('first broken');
  try {
    const p = createPersistence(normalize);
    p.load();
    values.set(STORAGE_KEY, 'second broken');
    p.reload();
    const backups = [...values]
      .filter(([key]) => key.startsWith(RECOVERY_KEY + '-'))
      .map(([, raw]) => raw);
    assert.ok(backups.includes('first broken'));
    assert.ok(backups.includes('second broken'));
    p.dispose();
  } finally {
    cleanup();
  }
});
test('missing Web Locks disables saving and preserves the source', async () => {
  const { values } = setup(JSON.stringify({ value: 1 }));
  try {
    navigator.locks = undefined;
    const p = createPersistence(normalize);
    p.load();
    assert.equal(await p.save({ value: 2 }), false);
    assert.equal(values.get(STORAGE_KEY), JSON.stringify({ value: 1 }));
    p.dispose();
  } finally {
    cleanup();
  }
});

test('reloading the same corrupt payload is idempotent and recoveries can be exported then cleared', () => {
  const { values } = setup('repeat broken');
  try {
    const p = createPersistence(normalize);
    p.load();
    const count = values.size;
    p.reload();
    p.reload();
    assert.equal(values.size, count);
    values.set(STORAGE_KEY, 'another broken');
    p.reload();
    assert.equal(p.getRecoveries().length, 2);
    assert.equal(p.clearRecovery(), true);
    assert.equal(values.get(STORAGE_KEY), 'another broken');
    assert.equal(p.getRecovery(), null);
    p.dispose();
  } finally {
    cleanup();
  }
});

test('existing diagrams remain available under the legacy storage key after renaming', async () => {
  const raw = JSON.stringify({ value: 'saved before rename' });
  const { values } = setup(raw);
  try {
    assert.equal(STORAGE_KEY, 'mindmap-studio-state');
    const p = createPersistence(normalize);
    assert.deepEqual(p.load(), { value: 'saved before rename' });
    assert.equal(await p.save({ value: 'OpenMindMap edit' }), true);
    assert.equal(values.get(STORAGE_KEY), JSON.stringify({ value: 'OpenMindMap edit' }));
    p.dispose();
  } finally {
    cleanup();
  }
});
