// Keep the legacy key so existing diagrams survive the OpenMindMap rename.
export const STORAGE_KEY = 'mindmap-studio-state';
export const RECOVERY_KEY = `${STORAGE_KEY}-recovery`;
const LOCK_NAME = `${STORAGE_KEY}-write`;
const STATUS = {
  saved: '已自动保存到本地',
  unavailable: '无法自动保存，请导出备份',
  corrupt: '检测到损坏的本地数据，已保留恢复副本；请导出备份',
  backupFailed: '检测到损坏的本地数据且恢复备份失败，已停用自动保存；请导出备份',
  conflict: '存档冲突：其他窗口已更新，请导出当前草稿或载入最新存档',
  readError: '无法读取本地数据，请导出备份',
};

/**
 * Guarded persistence with corrupt-payload recovery and cross-tab CAS.
 * @param {(input: unknown) => any} normalize
 * @param {{onExternal?: (state: any) => void, onStatus?: (message: string) => void}} options
 */
export function createPersistence(normalize, { onExternal, onStatus } = {}) {
  let epoch = 0;
  let expectedRaw = null;
  let loaded = false;
  let disabled = false;
  let recovery = null;
  let queue = Promise.resolve();
  let pendingCount = 0;
  const status = (message) => {
    try {
      onStatus?.(message);
    } catch {
      /* isolate UI callback errors */
    }
  };

  function decode(raw) {
    if (raw === null) return null;
    try {
      return normalize(JSON.parse(raw)) ?? null;
    } catch {
      return null;
    }
  }

  function read({ accept = false } = {}) {
    ++epoch;
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      disabled = true;
      status(STATUS.readError);
      return null;
    }
    if (raw === null) {
      expectedRaw = null;
      loaded = true;
      if (accept) disabled = false;
      return null;
    }
    const state = decode(raw);
    if (state !== null) {
      expectedRaw = raw;
      loaded = true;
      if (accept) {
        disabled = false;
        status(STATUS.saved);
      }
      return state;
    }
    recovery = raw;
    loaded = true;
    expectedRaw = raw;
    let backedUp = false;
    try {
      let first = 2166136261,
        second = 5381;
      for (let i = 0; i < raw.length; i++) {
        first = Math.imul(first ^ raw.charCodeAt(i), 16777619);
        second = Math.imul(second, 33) ^ raw.charCodeAt(i);
      }
      let key =
        RECOVERY_KEY +
        '-' +
        raw.length +
        '-' +
        (first >>> 0).toString(16) +
        '-' +
        (second >>> 0).toString(16);
      const prior = localStorage.getItem(key);
      if (prior !== null && prior !== raw) key += '-' + globalThis.crypto.randomUUID();
      if (localStorage.getItem(key) !== raw) localStorage.setItem(key, raw);
      // Keep every recovery payload; this pointer is only the most recent one.
      localStorage.setItem(RECOVERY_KEY, raw);
      backedUp = true;
    } catch {
      /* source stays intact; keep in-memory copy */
    }
    disabled = !backedUp;
    status(backedUp ? STATUS.corrupt : STATUS.backupFailed);
    return null;
  }

  function load() {
    return read();
  }
  function reload() {
    return read({ accept: true });
  }
  function acceptExternal() {
    return reload();
  }
  function getRecovery() {
    if (recovery !== null) return recovery;
    try {
      return localStorage.getItem(RECOVERY_KEY);
    } catch {
      return null;
    }
  }

  function getRecoveries() {
    const found = new Map();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === RECOVERY_KEY || key?.startsWith(RECOVERY_KEY + '-')) {
          const raw = localStorage.getItem(key);
          if (raw !== null) found.set(raw, { key, raw });
        }
      }
    } catch {
      /* leave disk copies intact */
    }
    if (recovery !== null && !found.has(recovery))
      found.set(recovery, { key: null, raw: recovery });
    return [...found.values()];
  }
  function clearRecovery() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === RECOVERY_KEY || key?.startsWith(RECOVERY_KEY + '-')) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
      recovery = null;
      return true;
    } catch {
      return false;
    }
  }

  function save(state) {
    let raw;
    try {
      raw = JSON.stringify(state);
    } catch {
      disabled = true;
      status(STATUS.unavailable);
      return Promise.resolve(false);
    }
    const generation = epoch;
    ++pendingCount;
    if (!disabled) status('正在自动保存…');
    const operation = queue.then(async () => {
      if (generation !== epoch) return false;
      if (disabled || !loaded) {
        status(STATUS.unavailable);
        return false;
      }
      const locks = globalThis.navigator?.locks;
      if (!locks || typeof locks.request !== 'function') {
        disabled = true;
        status(STATUS.unavailable);
        return false;
      }
      try {
        const ok = await locks.request(LOCK_NAME, { mode: 'exclusive' }, () => {
          // This read/compare/write sequence has no await while the lock is held.
          if (generation !== epoch) return false;
          let currentRaw;
          try {
            currentRaw = localStorage.getItem(STORAGE_KEY);
          } catch {
            disabled = true;
            status(STATUS.readError);
            return false;
          }
          if (currentRaw !== expectedRaw) {
            disabled = true;
            status(STATUS.conflict);
            return false;
          }
          try {
            localStorage.setItem(STORAGE_KEY, raw);
          } catch {
            disabled = true;
            status(STATUS.unavailable);
            return false;
          }
          expectedRaw = raw;
          if (pendingCount === 1) status(STATUS.saved);
          return true;
        });
        return ok === true;
      } catch {
        disabled = true;
        status(STATUS.unavailable);
        return false;
      }
    });
    const completed = operation.finally(() => {
      --pendingCount;
    });
    queue = completed.then(
      () => undefined,
      () => undefined,
    );
    return completed;
  }

  const eventTarget = globalThis.window ?? globalThis;
  const onStorage = (event) => {
    if (event?.key !== STORAGE_KEY || event.newValue === null) return;
    const state = decode(event.newValue);
    if (state !== null) {
      try {
        onExternal?.(state);
      } catch {
        /* isolate consumer callback */
      }
    }
  };
  eventTarget.addEventListener?.('storage', onStorage);
  function dispose() {
    eventTarget.removeEventListener?.('storage', onStorage);
  }

  return { load, save, getRecovery, getRecoveries, clearRecovery, reload, acceptExternal, dispose };
}

export function readSaved(normalize) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
export function download(name, data, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
