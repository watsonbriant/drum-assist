/* DrumAssist — Chart store + persistence
 * Multi-chart library: chart metadata + bodies in localStorage,
 * one audio blob per chart in IndexedDB (keyed by chart id).
 * Self-contained; the same shape drops cleanly onto a Supabase backend later
 * (charts table + storage bucket for audio).
 */
(function () {
  "use strict";

  const LEGACY_CHART_KEY = "drumassist.chart.v1";
  const LIB_KEY = "drumassist.library.v1";   // array of chart metadata
  const CHART_PREFIX = "drumassist.chart.";   // + id  -> full chart JSON
  const CUR_KEY = "drumassist.currentId.v1";
  const UI_KEY = "drumassist.ui.v1";
  const DB_NAME = "drumassist";
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
      version: 2,
      id: uid(),
      name: "Untitled chart",
      audioName: null,
      bpm: 120,
      offset: 0,
      beatsPerBar: 4,
      tsNum: 4,
      tsDen: 4,
      duration: 0,
      notes: [],
      updatedAt: Date.now()
    };
  }

  function metaOf(c) {
    return {
      id: c.id, name: c.name, bpm: c.bpm,
      tsNum: c.tsNum || c.beatsPerBar || 4, tsDen: c.tsDen || 4,
      duration: c.duration || 0, audioName: c.audioName || null,
      noteCount: (c.notes || []).length, updatedAt: c.updatedAt || Date.now()
    };
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

  function saveChartToLibrary(chart) {
    if (!chart.id) chart.id = uid();
    chart.updatedAt = Date.now();
    try { localStorage.setItem(CHART_PREFIX + chart.id, JSON.stringify(chart)); } catch (e) {}
    const idx = readIndex().filter(function (m) { return m.id !== chart.id; });
    idx.push(metaOf(chart));
    writeIndex(idx);
    setCurrentId(chart.id);
    return chart;
  }

  function deleteChartById(id) {
    try { localStorage.removeItem(CHART_PREFIX + id); } catch (e) {}
    writeIndex(readIndex().filter(function (m) { return m.id !== id; }));
    clearAudio(id);
  }

  function getCurrentId() { try { return localStorage.getItem(CUR_KEY); } catch (e) { return null; } }
  function setCurrentId(id) { try { localStorage.setItem(CUR_KEY, id); } catch (e) {} }

  function newChart() { return defaultChart(); }

  // duplicate an existing chart (new id, " copy" name) — caller copies audio
  function duplicateChart(chart, newName) {
    const c = Object.assign(defaultChart(), JSON.parse(JSON.stringify(chart)));
    c.id = uid();
    c.name = newName || (chart.name + " copy");
    c.updatedAt = Date.now();
    return c;
  }

  // ---- One-time migration of the old single-chart format ----
  function migrateLegacy() {
    try {
      if (readIndex().length > 0) return;
      const raw = localStorage.getItem(LEGACY_CHART_KEY);
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
  function openDB() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function saveAudio(id, name, arrayBuffer) {
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

  function rawLoadAudio(key) {
    return (async function () {
      try {
        const db = await openDB();
        const rec = await new Promise(function (resolve, reject) {
          const tx = db.transaction(DB_STORE, "readonly");
          const r = tx.objectStore(DB_STORE).get(key);
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { reject(r.error); };
        });
        db.close();
        return rec || null;
      } catch (e) { return null; }
    })();
  }
  function loadAudio(id) { return rawLoadAudio(id); }

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
    if (rec) await saveAudio(toId, rec.name, rec.data);
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

  window.DAStore = {
    uid, defaultChart, newChart, duplicateChart, loadUI, saveUI,
    listCharts, loadChartById, saveChartToLibrary, deleteChartById,
    getCurrentId, setCurrentId, migrateLegacy,
    saveAudio, loadAudio, clearAudio, copyAudio, exportJSON, importJSON,
    tsNum, tsDen, secPerBeat, isAccentBeat, isBarStart,
    DEFAULT_KEYMAP: DEFAULT_KEYMAP
  };
})();
