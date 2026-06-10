// @ts-nocheck
/* WorshipAssist — Chart store + persistence
 * Local cache: chart metadata + bodies in localStorage,
 * audio blobs in IndexedDB. Cloud sync via Supabase when configured.
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
  const DB_NAME = "worshipassist";
  const DB_STORE = "audio";

  let _id = 1;
  function uid() { return "c" + (Date.now().toString(36)) + (_id++).toString(36); }

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

  // ---- UI prefs ----
  function loadUI() {
    try { const raw = localStorage.getItem(UI_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }
  function saveUI(ui) { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }

  // ---- Library (localStorage) ----
  function readIndex() {
    try { const raw = localStorage.getItem(LIB_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
  }
  function writeIndex(arr) { try { localStorage.setItem(LIB_KEY, JSON.stringify(arr)); } catch (e) {} }

  function listCharts() {
    return readIndex().slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  function loadChartById(id) {
    try {
      const raw = localStorage.getItem(CHART_PREFIX + id);
      if (!raw) return null;
      return Object.assign(defaultChart(), JSON.parse(raw));
    } catch (e) { return null; }
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

  const _syncTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  function scheduleRemoteChartSave(chart) {
    if (!DARemote.isConfigured()) return;
    const id = chart.id;
    clearTimeout(_syncTimers[id]);
    _syncTimers[id] = setTimeout(function () {
      DARemote.upsertChart(chart).catch(function (e) {
        console.warn("Chart cloud sync failed:", e);
      });
    }, 800);
  }

  function saveChartToLibrary(chart) {
    const result = saveChartToLibraryLocal(chart);
    scheduleRemoteChartSave(chart);
    return result;
  }

  function deleteChartById(id) {
    const c = loadChartById(id);
    const path = c ? chartAudioPath(c) : null;
    try { localStorage.removeItem(CHART_PREFIX + id); } catch (e) {}
    writeIndex(readIndex().filter(function (m) { return m.id !== id; }));
    clearAudio(id);
    if (DARemote.isConfigured()) {
      DARemote.deleteChart(id).catch(function (e) {
        console.warn("Chart cloud delete failed:", e);
      });
      if (path) {
        DARemote.deleteAudio(path).catch(function (e) {
          console.warn("Audio cloud delete failed:", e);
        });
      }
    }
  }

  function getCurrentId() { try { return localStorage.getItem(CUR_KEY); } catch (e) { return null; } }
  function setCurrentId(id) { try { localStorage.setItem(CUR_KEY, id); } catch (e) {} }

  function newChart() { return defaultChart(); }

  // duplicate an existing chart (new id, " copy" name) — caller copies audio
  function duplicateChart(chart, newName) {
    const c = Object.assign(defaultChart(), JSON.parse(JSON.stringify(chart)));
    c.id = uid();
    c.name = newName || (chart.name + " copy");
    c.audioPath = null;
    c.updatedAt = Date.now();
    return c;
  }

  // ---- Cloud sync ----
  async function syncFromRemote() {
    if (!DARemote.isConfigured()) return false;
    try {
      const remote = await DARemote.listChartsFull();
      const remoteIds = new Set(remote.map(function (c) { return c.id; }));

      for (const c of remote) {
        saveChartToLibraryLocal(c);
      }

      for (const m of readIndex()) {
        if (!remoteIds.has(m.id)) {
          const c = loadChartById(m.id);
          if (c) await DARemote.upsertChart(c);
        }
      }

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
      if (readIndex().length > 0) return;
      const raw = localStorage.getItem(LEGACY_CHART_KEY) || localStorage.getItem(OLD_LEGACY_CHART_KEY);
      if (!raw) return;
      const c = Object.assign(defaultChart(), JSON.parse(raw));
      c.id = uid();
      saveChartToLibrary(c);
      // move legacy "current" audio to this id
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
    if (DARemote.isConfigured()) {
      try {
        const path = await DARemote.uploadAudio(id, name, arrayBuffer);
        const c = loadChartById(id);
        if (c && path) {
          c.audioPath = path;
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
    if (!DARemote.isConfigured()) return null;
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
    if (!DARemote.isConfigured()) return;
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

export const DAStore = {
  uid, defaultChart, newChart, duplicateChart, loadUI, saveUI,
  listCharts, loadChartById, saveChartToLibrary, deleteChartById,
  getCurrentId, setCurrentId, migrateFromDrumAssist, migrateLegacy, syncFromRemote,
  saveAudio, loadAudio, clearAudio, copyAudio, exportJSON, importJSON,
  tsNum, tsDen, secPerBeat, isAccentBeat, isBarStart,
  DEFAULT_KEYMAP: DEFAULT_KEYMAP
};
