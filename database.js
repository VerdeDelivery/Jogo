const DB_NAME = 'subway-run-local';
const DB_VERSION = 1;

class LocalGameDatabase {
  constructor() { this.connection = null; }
  open() {
    if (this.connection) return Promise.resolve(this.connection);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath:'key' });
        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath:'uid' });
        if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath:'id', autoIncrement:true });
      };
      request.onsuccess = () => { this.connection = request.result; resolve(this.connection); };
      request.onerror = () => reject(request.error);
    });
  }
  async request(store, mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), request = action(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  put(store, value) { return this.request(store, 'readwrite', table => table.put(value)).catch(() => null); }
  addRun(value) { return this.request('runs', 'readwrite', table => table.add(value)).catch(() => null); }
  async hydrate(keys) {
    for (const key of keys) {
      try {
        const saved = await this.request('settings', 'readonly', table => table.get('legacy:' + key));
        const local = localStorage.getItem(key);
        if (saved && typeof saved.value === 'string') localStorage.setItem(key, saved.value);
        else if (local !== null) await this.put('settings', { key:'legacy:' + key, value:local, updatedAt:Date.now() });
      } catch (_) {}
    }
    try {
      const raw = localStorage.getItem('rio_accts'), accounts = raw ? JSON.parse(raw) : {};
      for (const account of Object.values(accounts || {})) if (account && account.uid) await this.put('profiles', account);
      const active = JSON.parse(localStorage.getItem('rio_acct') || 'null');
      if (active && active.uid) await this.put('profiles', active);
      for (const [dbKey, storageKey] of [['music','sr_music_cfg'],['music-files','sr_music_mine']]) {
        const saved = await this.request('settings', 'readonly', table => table.get(dbKey));
        if (saved) localStorage.setItem(storageKey, JSON.stringify(saved.value));
      }
      const savedGame = await this.request('settings', 'readonly', table => table.get('game'));
      if (savedGame && savedGame.value) localStorage.setItem('subwayrun_rio_v4', JSON.stringify(savedGame.value));
      else {
        const config = JSON.parse(localStorage.getItem('subwayrun_rio_v4') || 'null');
        if (config) await this.put('settings', { key:'game', value:config, updatedAt:Date.now() });
      }
      const profiles = await this.request('profiles', 'readonly', table => table.getAll());
      if (profiles.length) {
        const accountMap = Object.fromEntries(profiles.filter(p => p.name).sort((a, b) => ((a.online ? 1 : 0) - (b.online ? 1 : 0)) || ((a.updatedAt || 0) - (b.updatedAt || 0))).map(p => [p.name.trim().toLowerCase(), p])); // a conta online/mais recente vence quando o nome se repete
        localStorage.setItem('rio_accts', JSON.stringify(accountMap));
      }
      const savedActive = await this.request('settings', 'readonly', table => table.get('active-profile'));
      const localActive = localStorage.getItem('rio_acct');
      if (localActive) { try { const la = JSON.parse(localActive); if (la && la.uid) await this.put('settings', { key:'active-profile', value:la, updatedAt:Date.now() }); } catch (_) {} } // o que está no aparelho é o mais novo
      else if (savedActive && savedActive.value) localStorage.setItem('rio_acct', JSON.stringify(savedActive.value));
    } catch (_) {}
  }
}

export const LocalDB = new LocalGameDatabase();
