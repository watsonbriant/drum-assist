// @ts-nocheck
/* WorshipAssist — Chart store + persistence
 * Cloud mode (Supabase configured): remote is source of truth; localStorage holds
 * unsynced drafts only until upsert succeeds. Session cache holds synced charts.
 * Offline mode: localStorage + IndexedDB only (legacy behavior).
 */

import { DARemote } from "./da-remote";

const OLD_LIB_KEY = "drumassist.library.v1";
  const OLD_CHART_PREFIX = "drumassist.chart.";
  const OLD_CUR_KEY = "drumassist.currentId.v1";
  const OLD_UI_KEY = "drumassist.ui.v1";
  const OLD_LEGACY_CHART_KEY = "drumassist.chart.v1";
  const OLD_DB_NAME = "drumassist";

  const LEGACY_CHART_KEY = "worshipassist.chart.v1";
  const LIB_KEY = "worshipassist.library.v1";
  const CHART_PREFIX = "worshipassist.chart.";
  const CUR_KEY = "worshipassist.currentId.v1";
  const UI_KEY = "worshipassist.ui.v1";
  const MIGRATED_KEY = "worshipassist.migrated.v1";
  const DRAFT_LIB_KEY = "worshipassist.draft.library.v1";
  const DRAFT_PREFIX = "worshipassist.draft.chart.";
  const DB_NAME = "worshipassist";
  const DB_STORE = "audio";

  let _id = 1;
  function uid() { return "c" + (Date.now().toString(36)) + (_id++).toString(36); }

  /** Synced charts from Supabase (session cache — repopulated on each sync). */
  let _syncedCharts = {};

  const DEFAULT_KEYMAP = {
    snare: "f",
    tom1: "d", cym1: "e",
    tom2: "j", cym2: "i",
    tom3: "k", cym3: "o",
    kick: "v"
  };

  function defaultChart() {
    return {
      version: 3,
      id: uid(),
      name: "Untitled chart",
      audioName: null,
      audioPath: null,
      songKey: "C",
      bpm: 120,
      offset: 0,
      chartStart: 0,
      beatsPerBar: 4,
      tsNum: 4,
      tsDen: 4,
      duration: 0,
      notes: [],
      chordNotes: [],
      updatedAt: Date.now()
    };
  }

  function metaOf(c) {
    return {
      id: c.id, name: c.name, bpm: c.bpm,
      tsNum: c.tsNum || c.beatsPerBar || 4, tsDen: c.tsDen || 4,
      duration: c.duration || 0, audioName: c.audioName || null,
      noteCount: (c.notes || []).length,
      chordNoteCount: (c.chordNotes || []).length,
      updatedAt: c.updatedAt || Date.now()
    };
  }

  function chartAudioPath(c) {
    if (c.audioPath) return c.audioPath;
    if (c.audioName) return DARemote.audioPath(c.id, c.audioName);
    return null;
  }

  function isCloudMode() { return DARemote.isConfigured(); }

  // ---- UI prefs (always localStorage) ----
  function loadUI() {
    try { const raw = localStorage.getItem(UI_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }
  function saveUI(ui) { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }

  // ---- Legacy offline library (localStorage) ----
  function readIndex() {
    try { const raw = localStorage.getItem(LIB_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
  }
  function writeIndex(arr) { try { localStorage.setItem(LIB_KEY, JSON.stringify(arr)); } catch (e) {} }

  function readDraftIndex() {
    try { const raw = localStorage.getItem(DRAFT_LIB_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
  }
  function writeDraftIndex(arr) {
    try { localStorage.setItem(DRAFT_LIB_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function saveChartToLibraryLocal(chart) {
    if (!chart.id) chart.id = uid();
    chart.updatedAt = Date.now();
    try { localStorage.setItem(CHART_PREFIX + chart.id, JSON.stringify(chart)); } catch (e) {}
    const idx = readIndex().filter(function (m) { return m.id !== chart.id; });
    idx.push(metaOf(chart));
    writeIndex(idx);
    setCurrentId(chart.id);
    return chart;
  }

  function removeLegacyLocalChart(id) {
    try { localStorage.removeItem(CHART_PREFIX + id); } catch (e) {}
    writeIndex(readIndex().filter(function (m) { return m.id !== id; }));
  }

  function saveDraft(chart) {
    if (!chart.id) chart.id = uid();
    chart.updatedAt = Date.now();
    try { localStorage.setItem(DRAFT_PREFIX + chart.id, JSON.stringify(chart)); } catch (e) {}
    const isNew = !_syncedCharts[chart.id];
    const idx = readDraftIndex().filter(function (m) { return m.id !== chart.id; });
    idx.push({ id: chart.id, isNew: isNew, updatedAt: chart.updatedAt });
    writeDraftIndex(idx);
    setCurrentId(chart.id);
    return chart;
  }

  function loadDraftById(id) {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + id);
      if (!raw) return null;
      return Object.assign(defaultChart(), JSON.parse(raw));
    } catch (e) { return null; }
  }

  function clearDraft(id) {
    try { localStorage.removeItem(DRAFT_PREFIX + id); } catch (e) {}
    writeDraftIndex(readDraftIndex().filter(function (m) { return m.id !== id; }));
  }

  function chartHasDraft(id) {
    if (!id || !isCloudMode()) return false;
    return !!loadDraftById(id);
  }

  function purgeStaleLocalCharts(remoteIds) {
    for (const m of readDraftIndex()) {
      if (!remoteIds.has(m.id) && !m.isNew) clearDraft(m.id);
    }

    const draftIds = new Set(readDraftIndex().map(function (m) { return m.id; }));

    for (const m of readIndex()) {
      if (!remoteIds.has(m.id) && !draftIds.has(m.id)) {
        try { localStorage.removeItem(CHART_PREFIX + m.id); } catch (e) {}
      }
    }
    writeIndex(readIndex().filter(function (m) {
      return remoteIds.has(m.id) || draftIds.has(m.id);
    }));
  }

  function listCharts() {
    if (!isCloudMode()) {
      return readIndex().slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    }
    const map = {};
    for (const id in _syncedCharts) map[id] = metaOf(_syncedCharts[id]);
    for (const m of readDraftIndex()) {
      const d = loadDraftById(m.id);
      if (d) map[m.id] = metaOf(d);
    }
    return Object.values(map).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  function loadChartById(id) {
    if (!id) return null;
    if (isCloudMode()) {
      const draft = loadDraftById(id);
      if (draft) return draft;
      if (_syncedCharts[id]) return Object.assign(defaultChart(), _syncedCharts[id]);
      return null;
    }
    try {
      const raw = localStorage.getItem(CHART_PREFIX + id);
      if (!raw) return null;
      return Object.assign(defaultChart(), JSON.parse(raw));
    } catch (e) { return null; }
  }

  const _syncTimers = {};
  let _syncListeners = [];

  function onSyncChange(fn) {
    _syncListeners.push(fn);
    return function () {
      _syncListeners = _syncListeners.filter(function (f) { return f !== fn; });
    };
  }

  function notifySyncChange() {
    for (const fn of _syncListeners) {
      try { fn(); } catch (e) {}
    }
  }

  async function commitChartRemote(chart) {
    if (!isCloudMode()) {
      return saveChartToLibraryLocal(chart);
    }
    if (!chart.id) chart.id = uid();
    clearTimeout(_syncTimers[chart.id]);
    await DARemote.upsertChart(chart);
    _syncedCharts[chart.id] = chart;
    clearDraft(chart.id);
    removeLegacyLocalChart(chart.id);
    notifySyncChange();
    return chart;
  }

  function scheduleRemoteChartSave(chart) {
    if (!isCloudMode()) return;
    const id = chart.id;
    clearTimeout(_syncTimers[id]);
    _syncTimers[id] = setTimeout(function () {
      commitChartRemote(chart).catch(function (e) {
        console.warn("Chart cloud sync failed:", e);
        notifySyncChange();
      });
    }, 800);
  }

  function saveChartToLibrary(chart) {
    if (!isCloudMode()) {
      return saveChartToLibraryLocal(chart);
    }
    const result = saveDraft(chart);
    scheduleRemoteChartSave(chart);
    notifySyncChange();
    return result;
  }

  async function deleteChartById(id) {
    const c = loadChartById(id);
    const path = c ? chartAudioPath(c) : null;
    clearDraft(id);
    delete _syncedCharts[id];
    removeLegacyLocalChart(id);
    await clearAudio(id);
    if (isCloudMode()) {
      await DARemote.deleteChart(id);
      if (path) {
        try { await DARemote.deleteAudio(path); } catch (e) {
          console.warn("Audio cloud delete failed:", e);
        }
      }
    }
    notifySyncChange();
  }

  function getCurrentId() { try { return localStorage.getItem(CUR_KEY); } catch (e) { return null; } }
  function setCurrentId(id) { try { localStorage.setItem(CUR_KEY, id); } catch (e) {} }

  function newChart() { return defaultChart(); }

  function duplicateChart(chart, newName) {
    const c = Object.assign(defaultChart(), JSON.parse(JSON.stringify(chart)));
    c.id = uid();
    c.name = newName || (chart.name + " copy");
    c.audioPath = null;
    c.updatedAt = Date.now();
    return c;
  }

  // ---- Cloud sync (remote wins) ----
  async function syncFromRemote() {
    if (!isCloudMode()) return false;
    try {
      const remote = await DARemote.listChartsFull();
      _syncedCharts = {};
      const remoteIds = new Set();
      for (const c of remote) {
        _syncedCharts[c.id] = c;
        remoteIds.add(c.id);
      }
      purgeStaleLocalCharts(remoteIds);
      notifySyncChange();
      return true;
    } catch (e) {
      console.warn("Remote sync failed:", e);
      return false;
    }
  }

  // ---- One-time migration from DrumAssist storage keys ----
  function migrateFromDrumAssist() {
    try {
      if (localStorage.getItem(MIGRATED_KEY)) return;

      if (!localStorage.getItem(LIB_KEY)) {
        const oldLib = localStorage.getItem(OLD_LIB_KEY);
        if (oldLib) localStorage.setItem(LIB_KEY, oldLib);
      }
      if (!localStorage.getItem(UI_KEY)) {
        const oldUi = localStorage.getItem(OLD_UI_KEY);
        if (oldUi) localStorage.setItem(UI_KEY, oldUi);
      }
      if (!localStorage.getItem(CUR_KEY)) {
        const oldCur = localStorage.getItem(OLD_CUR_KEY);
        if (oldCur) localStorage.setItem(CUR_KEY, oldCur);
      }

      for (const m of readIndex()) {
        const nk = CHART_PREFIX + m.id;
        const ok = OLD_CHART_PREFIX + m.id;
        const raw = localStorage.getItem(ok);
        if (raw && !localStorage.getItem(nk)) localStorage.setItem(nk, raw);
      }

      localStorage.setItem(MIGRATED_KEY, "1");
    } catch (e) {}
  }

  // ---- One-time migration of the old single-chart format ----
  function migrateLegacy() {
    try {
      if (readIndex().length > 0 || readDraftIndex().length > 0) return;
      const raw = localStorage.getItem(LEGACY_CHART_KEY) || localStorage.getItem(OLD_LEGACY_CHART_KEY);
      if (!raw) return;
      const c = Object.assign(defaultChart(), JSON.parse(raw));
      c.id = uid();
      saveChartToLibrary(c);
      (async function () {
        const old = await rawLoadAudio("current");
        if (old) { await saveAudio(c.id, old.name, old.data); await clearAudio("current"); }
      })();
      localStorage.removeItem(LEGACY_CHART_KEY);
    } catch (e) {}
  }

  // ---- IndexedDB: one audio blob per chart id ----
  function openDB(name) {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(name || DB_NAME, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function saveAudioLocal(id, name, arrayBuffer) {
    try {
      const db = await openDB();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put({ name: name, data: arrayBuffer }, id);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
      db.close();
    } catch (e) { /* quota / private mode — non-fatal */ }
  }

  async function saveAudio(id, name, arrayBuffer) {
    await saveAudioLocal(id, name, arrayBuffer);
    if (isCloudMode()) {
      try {
        const path = await DARemote.uploadAudio(id, name, arrayBuffer);
        const c = loadChartById(id);
        if (c && path) {
          c.audioPath = path;
          c.audioName = name;
          saveChartToLibrary(c);
        }
      } catch (e) {
        console.warn("Audio cloud upload failed:", e);
      }
    }
  }

  async function readAudioFromDb(dbName, key) {
    try {
      const db = await openDB(dbName);
      const rec = await new Promise(function (resolve, reject) {
        const tx = db.transaction(DB_STORE, "readonly");
        const r = tx.objectStore(DB_STORE).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
      db.close();
      return rec || null;
    } catch (e) { return null; }
  }

  function rawLoadAudio(key) {
    return (async function () {
      let rec = await readAudioFromDb(DB_NAME, key);
      if (!rec && OLD_DB_NAME !== DB_NAME) rec = await readAudioFromDb(OLD_DB_NAME, key);
      return rec;
    })();
  }

  async function loadAudio(id) {
    const local = await rawLoadAudio(id);
    if (local) return local;
    if (!isCloudMode()) return null;
    const c = loadChartById(id);
    const path = c ? chartAudioPath(c) : null;
    if (!path) return null;
    try {
      const remote = await DARemote.downloadAudio(path);
      if (!remote) return null;
      await saveAudioLocal(id, remote.name, remote.data);
      return remote;
    } catch (e) {
      console.warn("Audio cloud download failed:", e);
      return null;
    }
  }

  async function clearAudio(id) {
    try {
      const db = await openDB();
      await new Promise(function (resolve) {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
      db.close();
    } catch (e) {}
  }

  async function copyAudio(fromId, toId) {
    const rec = await rawLoadAudio(fromId);
    if (rec) {
      await saveAudio(toId, rec.name, rec.data);
      return;
    }
    if (!isCloudMode()) return;
    const src = loadChartById(fromId);
    const path = src ? chartAudioPath(src) : null;
    if (!path) return;
    const dst = loadChartById(toId);
    const name = (dst && dst.audioName) || (src && src.audioName);
    if (!name) return;
    try {
      const newPath = await DARemote.copyAudio(path, toId, name);
      if (newPath && dst) {
        dst.audioPath = newPath;
        saveChartToLibrary(dst);
      }
    } catch (e) {
      console.warn("Audio cloud copy failed:", e);
    }
  }

  // ---- Import / export chart JSON ----
  function exportJSON(chart) { return JSON.stringify(chart, null, 2); }
  function importJSON(text) { return Object.assign(defaultChart(), JSON.parse(text)); }

  // ---- Meter helpers ----
  function tsNum(c) { return c.tsNum || c.beatsPerBar || 4; }
  function tsDen(c) { return c.tsDen || 4; }
  function secPerBeat(c) { return (4 / tsDen(c)) * (60 / c.bpm); }
  function isAccentBeat(c, k) {
    const num = tsNum(c);
    const m = ((k % num) + num) % num;
    if (m === 0) return true;
    if (tsDen(c) === 8 && num % 3 === 0 && m % 3 === 0) return true;
    return false;
  }
  function isBarStart(c, k) {
    const num = tsNum(c);
    return (((k % num) + num) % num) === 0;
  }

  function chartStart(c) { return Math.max(0, c.chartStart ?? 0); }

  function clampSongPos(c, t) {
    const start = chartStart(c);
    const dur = c.duration || 0;
    if (dur > 0) return Math.max(start, Math.min(t, dur));
    return Math.max(start, t);
  }

export const DAStore = {
  uid, defaultChart, newChart, duplicateChart, loadUI, saveUI,
  listCharts, loadChartById, saveChartToLibrary, deleteChartById,
  commitChartRemote, chartHasDraft, isCloudMode, onSyncChange,
  getCurrentId, setCurrentId, migrateFromDrumAssist, migrateLegacy, syncFromRemote,
  saveAudio, loadAudio, clearAudio, copyAudio, exportJSON, importJSON,
  tsNum, tsDen, secPerBeat, isAccentBeat, isBarStart, chartStart, clampSongPos,
  DEFAULT_KEYMAP: DEFAULT_KEYMAP
};
