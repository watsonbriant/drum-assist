// @ts-nocheck
"use client";

/* WorshipAssist — Main app */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { DAStore as S } from "./da-store";
import { DAAudio as A } from "./da-audio";
import { HighwayCanvas, DA_LANE_COLORS as LANE_COLORS, DA_KICK_COLOR as KICK_COLOR, DA_CHORD_COLOR as CHORD_COLOR } from "./da-highway";
import { SidePanel } from "./da-side";

  const SNAP_OPTS = [
    { div: 1, label: "1/4" },
    { div: 2, label: "1/8" },
    { div: 4, label: "1/16" },
    { div: 8, label: "1/32" },
    { div: 3, label: "trip" }
  ];

  const MOBILE_BREAKPOINT = 1440;

  const TOOL_CYCLE = ["tom", "cymbal", "kick"];
  const TOOL_LABELS = { tom: "Tom", cymbal: "Cymbal", kick: "Kick" };
  function toolGlyph(tool) {
    const color = tool === "kick" ? KICK_COLOR : LANE_COLORS[2];
    if (tool === "cymbal") {
      return React.createElement("svg", { viewBox: "0 0 22 22", width: 16, height: 16 },
        React.createElement("polygon", { points: "11,2 20,11 11,20 2,11", fill: color }));
    }
    if (tool === "kick") {
      return React.createElement("svg", { viewBox: "0 0 22 22", width: 16, height: 16 },
        React.createElement("rect", { x: 1, y: 8, width: 20, height: 6, rx: 3, fill: color }));
    }
    return React.createElement("svg", { viewBox: "0 0 22 22", width: 16, height: 16 },
      React.createElement("circle", { cx: 11, cy: 11, r: 8, fill: color }));
  }

  // --- icons ---
  const I = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    stop: "M6 6h12v12H6z",
    rewind: "M6 6h2v12H6zm3 6l9 6V6z"
  };
  function Icon(p) {
    return React.createElement("svg", { viewBox: "0 0 24 24", width: p.size || 18, height: p.size || 18, fill: "currentColor" },
      React.createElement("path", { d: I[p.name] }));
  }

  function fmtTime(t) {
    if (t == null || !isFinite(t)) t = 0;
    const neg = t < 0; t = Math.abs(t);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t * 100) % 100);
    return (neg ? "-" : "") + m + ":" + String(s).padStart(2, "0") + "." + String(cs).padStart(2, "0");
  }

  export default function App() {
    const ui0 = S.loadUI();
    const [ready, setReady] = useState(false);
    const [chart, setChart] = useState(null);
    const [charts, setCharts] = useState([]);
    const [chartsOpen, setChartsOpen] = useState(false);
    const [syncTick, setSyncTick] = useState(0);
    const [syncing, setSyncing] = useState(false);
    const [keymap, setKeymap] = useState(Object.assign({}, S.DEFAULT_KEYMAP, ui0.keymap || {}));
    const [keyEntry, setKeyEntry] = useState(!!ui0.keyEntry);
    const [listenAction, setListenAction] = useState(null);
    const [mode, setMode] = useState(ui0.mode || "edit");
    const [isMobile, setIsMobile] = useState(false);
    const [tool, setTool] = useState(ui0.tool || "tom");
    const [snapEnabled, setSnapEnabled] = useState(ui0.snapEnabled !== false);
    const [snapDiv, setSnapDiv] = useState(ui0.snapDiv || 2);
    const [spacing, setSpacing] = useState(ui0.spacing || 5);
    const [rate, setRate] = useState(ui0.rate || 1);
    const [countInOn, setCountInOn] = useState(ui0.countInOn !== false);
    const [metro, setMetro] = useState(!!ui0.metro);
    const [loopOn, setLoopOn] = useState(!!ui0.loopOn);
    const [loopA, setLoopA] = useState(ui0.loopA != null ? ui0.loopA : null);
    const [loopB, setLoopB] = useState(ui0.loopB != null ? ui0.loopB : null);
    const [chartType, setChartType] = useState(ui0.chartType || "drum");
    const [showChordNames, setShowChordNames] = useState(!!ui0.showChordNames);
    const [chordEdit, setChordEdit] = useState(null);
    const [chordHoverT, setChordHoverT] = useState(null);
    const [mobileOptsOpen, setMobileOptsOpen] = useState(false);

    const [hasAudio, setHasAudio] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [tick, setTick] = useState(0);

    const posRef = useRef(0);            // stopped position (s)
    const peaksRef = useRef(null);
    const fileRef = useRef(null);
    const waveRef = useRef(null);
    const miniRef = useRef(null);
    const scrollSecRef = useRef(2.2);
    const chartRef = useRef(chart);
    chartRef.current = chart;
    const stateRef = useRef({});
    stateRef.current = { rate, loopOn, loopA, loopB, metro, playing, snapDiv, snapEnabled, chartType };

    // mobile layout: player only below 1440px
    useEffect(function () {
      function check() { setIsMobile(window.innerWidth < MOBILE_BREAKPOINT); }
      check();
      window.addEventListener("resize", check);
      return function () { window.removeEventListener("resize", check); };
    }, []);
    useEffect(function () {
      if (isMobile && mode !== "play") setMode("play");
    }, [isMobile, mode]);

    const activeMode = isMobile ? "play" : mode;

    useEffect(function () {
      return S.onSyncChange(function () {
        setSyncTick(function (t) { return t + 1; });
        setCharts(S.listCharts());
      });
    }, []);

    // load charts from cloud + local drafts
    useEffect(function () {
      let dead = false;
      (async function () {
        S.migrateFromDrumAssist();
        S.migrateLegacy();
        await S.syncFromRemote();
        if (dead) return;
        var id = S.getCurrentId();
        var c = id ? S.loadChartById(id) : null;
        if (!c) { c = S.newChart(); S.saveChartToLibrary(c); }
        setChart(c);
        setCharts(S.listCharts());
        setReady(true);
      })();
      return function () { dead = true; };
    }, []);

    // persist
    useEffect(function () {
      if (!ready || !chart) return;
      S.saveChartToLibrary(chart);
      setCharts(S.listCharts());
    }, [chart, ready]);
    useEffect(function () {
      S.saveUI({ mode, tool, snapEnabled, snapDiv, spacing, rate, countInOn, metro, loopOn, loopA, loopB, keymap, keyEntry, chartType, showChordNames });
    }, [mode, tool, snapEnabled, snapDiv, spacing, rate, countInOn, metro, loopOn, loopA, loopB, keymap, keyEntry, chartType, showChordNames]);

    // ---- audio loading ----
    const afterAudioReady = useCallback(function (dur) {
      peaksRef.current = A.computePeaks(1400);
      setHasAudio(true);
      setChart(function (c) { return Object.assign({}, c, { duration: dur }); });
    }, []);

    async function handleFile(file) {
      try {
        const res = await A.loadFile(file);
        posRef.current = S.chartStart(chartRef.current);
        setPlaying(false);
        afterAudioReady(res.duration);
        setChart(function (c) { return Object.assign({}, c, { audioName: file.name, duration: res.duration }); });
        S.saveAudio(chartRef.current.id, file.name, res.arrayBuffer);
      } catch (e) {
        alert("Could not load that audio file. Try MP3, WAV, OGG or M4A.");
      }
    }

    // restore cached audio when chart is ready
    useEffect(function () {
      if (!ready || !chart) return;
      let dead = false;
      (async function () {
        const rec = await S.loadAudio(chart.id);
        if (dead || !rec) return;
        try {
          const res = await A.loadArrayBuffer(rec.data);
          afterAudioReady(res.duration);
        } catch (e) {}
      })();
      A.setOnEnded(function () { setPlaying(false); posRef.current = chartRef.current.duration; });
      return function () { dead = true; };
    }, [afterAudioReady, ready, chart && chart.id]);

    useEffect(function () {
      if (!chart) return;
      const start = S.chartStart(chart);
      if (posRef.current < start) {
        posRef.current = start;
        if (!A.isPlaying()) A.seek(start);
        setTick(function (t) { return t + 1; });
      }
    }, [chart && chart.chartStart, chart && chart.id]);

    function getSongPos() {
      return A.isPlaying() ? A.getPosition() : posRef.current;
    }

    // ---- chart library actions ----
    function loadAudioForCurrent(id) {
      (async function () {
        const rec = await S.loadAudio(id);
        if (rec) { try { const res = await A.loadArrayBuffer(rec.data); afterAudioReady(res.duration); } catch (e) {} }
      })();
    }
    function resetTransportForChart(nextChart) {
      A.stop(); setPlaying(false);
      const c = nextChart || chartRef.current;
      posRef.current = S.chartStart(c);
      setLoopA(null); setLoopB(null); setLoopOn(false);
      setHasAudio(false); peaksRef.current = null;
      setChordEdit(null); setChordHoverT(null);
    }
    function openChart(id) {
      if (id === chartRef.current.id && hasAudio) { setChartsOpen(false); return; }
      const c = S.loadChartById(id);
      if (!c) return;
      resetTransportForChart(c);
      S.setCurrentId(id);
      setChart(c);
      setChartsOpen(false);
      loadAudioForCurrent(id);
    }
    function newChartAction() {
      const c = S.newChart();
      S.saveChartToLibrary(c);
      resetTransportForChart();
      setChart(c);
      setCharts(S.listCharts());
      setChartsOpen(false);
    }
    function duplicateChartAction() {
      const src = chartRef.current;
      const c = S.duplicateChart(src);
      S.saveChartToLibrary(c);
      (async function () { await S.copyAudio(src.id, c.id); })();
      setChart(c);
      setCharts(S.listCharts());
      setChartsOpen(false);
    }
    function deleteChartAction(id) {
      if (!confirm("Delete this chart and its audio? This can't be undone.")) return;
      (async function () {
        try {
          await S.deleteChartById(id);
          const list = S.listCharts();
          setCharts(list);
          if (id === chartRef.current.id) {
            if (list.length) openChart(list[0].id);
            else newChartAction();
          }
        } catch (e) {
          alert("Could not delete chart from cloud. Check your connection and try again.");
        }
      })();
    }

    async function saveToCloudNow() {
      if (!chart || !S.isCloudMode()) return;
      setSyncing(true);
      try {
        await S.commitChartRemote(chart);
        setCharts(S.listCharts());
      } catch (e) {
        alert("Could not save to cloud. Your changes are still kept locally until sync succeeds.");
      } finally {
        setSyncing(false);
      }
    }

    // ---- live keyboard note entry ----
    const LIVE_MAP = {
      snare: { lane: 0, kind: "snare" },
      tom1: { lane: 1, kind: "tom" }, cym1: { lane: 1, kind: "cymbal" },
      tom2: { lane: 2, kind: "tom" }, cym2: { lane: 2, kind: "cymbal" },
      tom3: { lane: 3, kind: "tom" }, cym3: { lane: 3, kind: "cymbal" },
      kick: { lane: -1, kind: "kick" }
    };
    function addNoteLive(action) {
      const nk = LIVE_MAP[action];
      if (!nk) return;
      const c = chartRef.current;
      let t = getSongPos();
      if (snapEnabled) {
        const step = S.secPerBeat(c) / (snapDiv || 1);
        t = c.offset + Math.round((t - c.offset) / step) * step;
      }
      if (t < 0) t = 0;
      addNote({ t: t, lane: nk.lane, kind: nk.kind });
    }

    // ---- transport engine RAF ----
    const metroBeatRef = useRef(-1);
    useEffect(function () {
      let raf;
      let lastCs = -1;
      function loop() {
        const st = stateRef.current;
        const c = chartRef.current;
        if (A.isPlaying()) {
          let pos = A.getPosition();
          // loop
          if (st.loopOn && st.loopA != null && st.loopB != null && st.loopB > st.loopA && pos >= st.loopB) {
            A.seek(st.loopA);
            metroBeatRef.current = -1;
            pos = st.loopA;
          }
          // metronome scheduling (lookahead ~0.3s)
          if (st.metro && c.bpm > 0) {
            const spb = S.secPerBeat(c);
            const horizon = pos + 0.3;
            let k = Math.max(metroBeatRef.current + 1, Math.floor((pos - c.offset) / spb));
            for (; ; k++) {
              const bt = c.offset + k * spb;
              if (bt > horizon) break;
              if (bt < pos - 0.02) continue;
              if (k <= metroBeatRef.current) continue;
              const when = A.ctxTimeForSong(bt);
              if (when > A.ctxNow()) {
                A.scheduleClick(when, S.isAccentBeat(c, k));
              }
              metroBeatRef.current = k;
            }
          }
          const cs = Math.floor(pos * 100);
          if (cs !== lastCs) { lastCs = cs; setTick(function (t) { return t + 1; }); }
        }
        drawWave();
        drawMinimap();
        raf = requestAnimationFrame(loop);
      }
      raf = requestAnimationFrame(loop);
      return function () { cancelAnimationFrame(raf); };
    }, []);

    // ---- play / pause / stop ----
    async function togglePlay() {
      if (!hasAudio) { fileRef.current && fileRef.current.click(); return; }
      if (A.isPlaying()) {
        posRef.current = A.getPosition();
        A.stop();
        setPlaying(false);
      } else {
        await A.resume();
        A.setRate(stateRef.current.rate);
        metroBeatRef.current = -1;
        let from = S.clampSongPos(chart, posRef.current);
        const start = S.chartStart(chart);
        if (loopOn && loopA != null && (from < loopA || (loopB != null && from >= loopB))) {
          from = S.clampSongPos(chart, loopA);
        }
        if (countInOn) {
          await A.countInAndPlay(S.tsNum(chart), S.secPerBeat(chart), start);
          posRef.current = start;
        } else {
          await A.play(from);
        }
        setPlaying(true);
      }
    }
    function stopToStart() {
      A.stop();
      const c = chartRef.current;
      const start = S.chartStart(c);
      const to = (loopOn && loopA != null && loopA >= start) ? loopA : start;
      posRef.current = to;
      A.seek(to);
      setPlaying(false);
      setTick(function (t) { return t + 1; });
    }

    function seekTo(t) {
      t = S.clampSongPos(chartRef.current, t);
      posRef.current = t;
      if (A.isPlaying()) { metroBeatRef.current = -1; A.seek(t); }
      setTick(function (x) { return x + 1; });
    }
    function scrubEdit(t) {
      t = Math.max(0, Math.min(t, chart.duration || 9999));
      posRef.current = t;
      setTick(function (x) { return x + 1; });
    }
    function scrubTransport(t) {
      t = S.clampSongPos(chartRef.current, t);
      posRef.current = t;
      if (A.isPlaying()) { metroBeatRef.current = -1; A.seek(t); }
      setTick(function (x) { return x + 1; });
    }

    function setRateSafe(r) { setRate(r); if (A.isPlaying()) A.setRate(r); }

    // ---- notes ----
    function addNote(n) {
      setChart(function (c) {
        // avoid exact duplicates on same lane within a tiny window
        const dup = c.notes.find(function (m) {
          return m.lane === n.lane && Math.abs(m.t - n.t) < 0.012 &&
            (m.lane === -1 ? true : true);
        });
        if (dup && dup.kind === n.kind) return c;
        const notes = dup ? c.notes.filter(function (m) { return m !== dup; }) : c.notes.slice();
        notes.push(Object.assign({ id: S.uid() }, n));
        return Object.assign({}, c, { notes: notes });
      });
    }
    function removeNote(id) {
      setChart(function (c) { return Object.assign({}, c, { notes: c.notes.filter(function (m) { return m.id !== id; }) }); });
    }
    function clearNotes() {
      if (confirm("Clear all notes from this chart?")) setChart(function (c) { return Object.assign({}, c, { notes: [] }); });
    }
    function clearChordNotes() {
      if (confirm("Clear all chords from this chart?")) setChart(function (c) { return Object.assign({}, c, { chordNotes: [] }); });
    }

    function saveChordEdit() {
      if (!chordEdit) return;
      const edit = chordEdit;
      setChart(function (c) {
        const chordNotes = (c.chordNotes || []).slice();
        if (edit.isNew) {
          chordNotes.push({ id: edit.id, t: edit.t, nashville: edit.nashville });
        } else {
          for (let i = 0; i < chordNotes.length; i++) {
            if (chordNotes[i].id === edit.id) {
              chordNotes[i] = { id: edit.id, t: edit.t, nashville: edit.nashville };
              break;
            }
          }
        }
        return Object.assign({}, c, { chordNotes: chordNotes });
      });
      setChordEdit(null);
    }
    function deleteChordEdit() {
      if (!chordEdit || chordEdit.isNew) { setChordEdit(null); return; }
      const id = chordEdit.id;
      setChart(function (c) {
        return Object.assign({}, c, { chordNotes: (c.chordNotes || []).filter(function (n) { return n.id !== id; }) });
      });
      setChordEdit(null);
    }
    function cancelChordEdit() {
      setChordEdit(null);
    }
    function onChordPlace(t) {
      setChordEdit({ id: S.uid(), t: t, nashville: "1", isNew: true });
    }
    function onChordEdit(n) {
      setChordEdit({ id: n.id, t: n.t, nashville: n.nashville || "1", isNew: false });
    }

    function patchChart(patch) {
      setChart(function (c) {
        let nextPatch = Object.assign({}, patch);
        if (nextPatch.chartStart != null) {
          const dur = c.duration || 0;
          nextPatch.chartStart = Math.max(0, dur > 0 ? Math.min(nextPatch.chartStart, dur) : nextPatch.chartStart);
        }
        if (nextPatch.offset != null && nextPatch.offset !== c.offset) {
          const newOffset = Math.max(0, nextPatch.offset);
          const delta = newOffset - c.offset;
          if (delta !== 0) {
            return Object.assign({}, c, nextPatch, {
              offset: newOffset,
              notes: (c.notes || []).map(function (n) {
                return Object.assign({}, n, { t: Math.max(0, n.t + delta) });
              }),
              chordNotes: (c.chordNotes || []).map(function (n) {
                return Object.assign({}, n, { t: Math.max(0, n.t + delta) });
              }),
            });
          }
        }
        return Object.assign({}, c, nextPatch);
      });
    }
    function cycleTool() {
      setTool(function (t) {
        const i = TOOL_CYCLE.indexOf(t);
        return TOOL_CYCLE[(i + 1) % TOOL_CYCLE.length];
      });
    }

    // ---- waveform drawing ----
    function drawWave() {
      const cv = waveRef.current;
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      }
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const c = chartRef.current;
      const dur = c.duration || 0;
      const peaks = peaksRef.current;
      ctx.fillStyle = "#16171a"; ctx.fillRect(0, 0, W, H);
      if (!peaks || !dur) return;
      const mid = H / 2;
      // loop region
      if (loopShownRef.current.on && loopShownRef.current.a != null && loopShownRef.current.b != null) {
        const xa = (loopShownRef.current.a / dur) * W, xb = (loopShownRef.current.b / dur) * W;
        ctx.fillStyle = "rgba(54,198,218,.12)";
        ctx.fillRect(xa, 0, xb - xa, H);
      }
      // waveform
      ctx.strokeStyle = "#41454d";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const n = peaks.length;
      for (let x = 0; x < W; x++) {
        const idx = Math.floor((x / W) * n);
        const v = peaks[idx] || 0;
        const h = v * (H * 0.46);
        ctx.moveTo(x + 0.5, mid - h);
        ctx.lineTo(x + 0.5, mid + h);
      }
      ctx.stroke();
      // beat ticks
      const spb = S.secPerBeat(c);
      if (spb > 0 && (W / (dur / spb)) > 4) {
        for (let k = 0; ; k++) {
          const bt = c.offset + k * spb;
          if (bt > dur) break;
          if (bt < 0) continue;
          const x = (bt / dur) * W;
          const isBar = S.isBarStart(c, k);
          ctx.fillStyle = isBar ? "rgba(174,182,194,.45)" : "rgba(120,128,140,.22)";
          ctx.fillRect(x, isBar ? 0 : H * 0.3, 1, isBar ? H : H * 0.4);
        }
      }
      // offset handle (first downbeat)
      const ox = (c.offset / dur) * W;
      ctx.fillStyle = "#e8c020";
      ctx.beginPath();
      ctx.moveTo(ox, 0); ctx.lineTo(ox - 6, 0); ctx.lineTo(ox, 10); ctx.lineTo(ox + 6, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(232,192,32,.6)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
      // chart start handle
      const cs = S.chartStart(c);
      const sx = (cs / dur) * W;
      ctx.fillStyle = "#36c6da";
      ctx.beginPath();
      ctx.moveTo(sx, H); ctx.lineTo(sx - 6, H); ctx.lineTo(sx, H - 10); ctx.lineTo(sx + 6, H);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(54,198,218,.55)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      if (cs > 0) {
        ctx.fillStyle = "rgba(0,0,0,.18)";
        ctx.fillRect(0, 0, sx, H);
      }
      // playhead
      const pos = getSongPos();
      const px = (pos / dur) * W;
      ctx.fillStyle = "#36c6da";
      ctx.fillRect(px - 1, 0, 2, H);
    }
    const loopShownRef = useRef({});
    loopShownRef.current = { on: loopOn, a: loopA, b: loopB };

    // ---- overview minimap (whole-song note density) ----
    function drawMinimap() {
      const cv = miniRef.current;
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      }
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#16171a"; ctx.fillRect(0, 0, W, H);
      const c = chartRef.current;
      const st = stateRef.current;
      const dur = c.duration || 0;
      const ct = st.chartType || "drum";
      const isChord = ct === "chord";
      const pad = 3;
      const colors = [LANE_COLORS[0], LANE_COLORS[1], LANE_COLORS[2], LANE_COLORS[3], KICK_COLOR];

      if (isChord) {
        ctx.fillStyle = "rgba(168,46,36,.08)";
        ctx.fillRect(0, pad, W, H - pad * 2);
      } else {
        const rows = 5;
        const rh = (H - pad * 2) / rows;
        for (let r = 0; r < rows; r++) {
          const y = pad + r * rh;
          ctx.fillStyle = (r % 2 === 0) ? "rgba(255,255,255,.02)" : "rgba(255,255,255,.035)";
          ctx.fillRect(0, y, W, rh - 1);
        }
      }

      if (!dur) {
        ctx.fillStyle = "#6d727b"; ctx.font = "11px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(
          isChord ? "chord overview — load audio & add chords" : "drum overview — load audio & add notes",
          W / 2, H / 2
        );
        ctx.textAlign = "start";
        return;
      }

      const chartStartT = S.chartStart(c);
      if (chartStartT > 0) {
        const sx = (chartStartT / dur) * W;
        ctx.fillStyle = "rgba(0,0,0,.22)";
        ctx.fillRect(0, pad, sx, H - pad * 2);
        ctx.fillStyle = "rgba(54,198,218,.45)";
        ctx.fillRect(sx, pad, 1, H - pad * 2);
      }

      // bar lines
      const spb = S.secPerBeat(c);
      if (spb > 0) {
        for (let k = 0; ; k++) {
          const bt = c.offset + k * spb;
          if (bt > dur) break;
          if (bt < 0) continue;
          if (!S.isBarStart(c, k)) continue;
          const x = (bt / dur) * W;
          ctx.fillStyle = "rgba(120,128,140,.18)";
          ctx.fillRect(x, pad, 1, H - pad * 2);
        }
      }
      // loop region
      if (st.loopOn && st.loopA != null && st.loopB != null) {
        const xa = (st.loopA / dur) * W, xb = (st.loopB / dur) * W;
        ctx.fillStyle = "rgba(54,198,218,.10)";
        ctx.fillRect(xa, 0, xb - xa, H);
      }

      const notes = isChord ? (c.chordNotes || []) : c.notes;
      for (const n of notes) {
        const x = (n.t / dur) * W;
        if (isChord) {
          ctx.fillStyle = CHORD_COLOR;
          ctx.fillRect(x - 2, pad + 2, 4, H - pad * 2 - 4);
        } else {
          const rows = 5;
          const rh = (H - pad * 2) / rows;
          const row = (n.lane === -1 || n.kind === "kick") ? 4 : n.lane;
          const y = pad + row * rh;
          ctx.fillStyle = colors[row];
          ctx.fillRect(x - 1, y + 1, 2, rh - 3);
        }
      }
      // current view window (portion shown on the highway)
      const pos = getSongPos();
      const vx = (pos / dur) * W;
      const vw = Math.max(2, (scrollSecRef.current / dur) * W);
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.fillRect(vx, 0, vw, H);
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.lineWidth = 1;
      ctx.strokeRect(vx + 0.5, 0.5, vw, H - 1);
      // playhead
      ctx.fillStyle = "#36c6da";
      ctx.fillRect(vx - 1, 0, 2, H);
    }
    function onMiniDown(e) {
      const cv = miniRef.current; const rect = cv.getBoundingClientRect();
      const dur = chartRef.current.duration || 0; if (!dur) return;
      function toT(ev) { return Math.max(0, Math.min(dur, ((ev.clientX - rect.left) / rect.width) * dur)); }
      seekTo(toT(e));
      function mv(ev) { seekTo(toT(ev)); }
      function up() { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
    }

    // waveform pointer
    const waveDragRef = useRef(null);
    function waveXToTime(e) {
      const cv = waveRef.current; const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const dur = chartRef.current.duration || 0;
      return Math.max(0, Math.min(dur, (x / rect.width) * dur));
    }
    function onWaveDown(e) {
      const cv = waveRef.current; const rect = cv.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const dur = chartRef.current.duration || 0;
      if (!dur) return;
      const t = waveXToTime(e);
      const x = e.clientX - rect.left;
      const ox = (chartRef.current.offset / dur) * rect.width;
      const sx = (S.chartStart(chartRef.current) / dur) * rect.width;
      if (y < 16 || Math.abs(x - ox) < 7) {
        waveDragRef.current = "offset";
        patchChart({ offset: t });
      } else if (y > rect.height - 16 || Math.abs(x - sx) < 7) {
        waveDragRef.current = "chartStart";
        patchChart({ chartStart: t });
      } else {
        waveDragRef.current = "seek";
        seekTo(t);
      }
      window.addEventListener("pointermove", onWaveMove);
      window.addEventListener("pointerup", onWaveUp);
    }
    function onWaveMove(e) {
      if (waveDragRef.current === "offset") patchChart({ offset: waveXToTime(e) });
      else if (waveDragRef.current === "chartStart") patchChart({ chartStart: waveXToTime(e) });
      else if (waveDragRef.current === "seek") seekTo(waveXToTime(e));
    }
    function onWaveUp() {
      waveDragRef.current = null;
      window.removeEventListener("pointermove", onWaveMove);
      window.removeEventListener("pointerup", onWaveUp);
    }

    // keyboard
    useEffect(function () {
      function onKey(e) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        const key = e.key === " " ? "space" : (e.key || "").toLowerCase();
        // assigning a hotkey?
        if (listenAction) {
          e.preventDefault();
          if (e.key === "Escape") { setListenAction(null); return; }
          setKeymap(function (m) { const nm = Object.assign({}, m); nm[listenAction] = key; return nm; });
          setListenAction(null);
          return;
        }
        // live note entry (editor mode)
        if (keyEntry && mode === "edit" && !e.repeat) {
          const action = Object.keys(keymap).find(function (a) { return keymap[a] === key; });
          if (action) { e.preventDefault(); addNoteLive(action); return; }
        }
        if (e.code === "Space") { e.preventDefault(); togglePlay(); }
        else if (e.key === "e" && window.innerWidth >= MOBILE_BREAKPOINT) setMode("edit");
        else if (e.key === "p") setMode("play");
        else if (e.code === "Enter") stopToStart();
      }
      window.addEventListener("keydown", onKey);
      return function () { window.removeEventListener("keydown", onKey); };
    });

    if (!ready || !chart) {
      return React.createElement("div", { className: "app", style: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" } },
        React.createElement("span", { style: { opacity: 0.6 } }, "Loading…"));
    }

    // ---- derived display ----
    const pos = getSongPos();
    const spb = S.secPerBeat(chart);
    const tsN = S.tsNum(chart);
    const beatF = (pos - chart.offset) / spb;
    const bar = beatF >= 0 ? Math.floor(beatF / tsN) + 1 : 0;
    const beat = beatF >= 0 ? Math.floor(((beatF % tsN) + tsN) % tsN) + 1 : 0;
    scrollSecRef.current = 3.7 - (spacing - 1) * (3.7 - 1.3) / 9;
    const hasDraft = S.isCloudMode() && S.chartHasDraft(chart.id);

    // ---- render ----
    return React.createElement("div", { className: "app", "data-mode": activeMode, "data-layout": isMobile ? "mobile" : "desktop" },
      // topbar
      React.createElement("div", { className: "topbar" },
        React.createElement("div", { className: "brand" },
          React.createElement("div", { className: "brand-mark" }),
          React.createElement("div", { className: "brand-name" }, "Worship", React.createElement("b", null, "Assist"))
        ),
        isMobile
          ? React.createElement("span", { className: "chart-name chart-name-readonly" }, chart.name)
          : React.createElement("input", {
            className: "chart-name", value: chart.name,
            onChange: function (e) { patchChart({ name: e.target.value }); },
            spellCheck: false
          }),
        React.createElement("div", { className: "charts-menu" },
          React.createElement("button", { className: "btn ghost charts-btn", onClick: function () { setChartsOpen(!chartsOpen); } },
            "Charts", React.createElement("span", { className: "caret" }, "▾")),
          chartsOpen ? React.createElement("div", { className: "charts-backdrop", onClick: function () { setChartsOpen(false); } }) : null,
          chartsOpen ? React.createElement("div", { className: "charts-pop" },
            React.createElement("div", { className: "charts-actions" },
              React.createElement("button", { className: "btn", onClick: newChartAction }, "+ New chart"),
              React.createElement("button", { className: "btn", onClick: duplicateChartAction }, "Duplicate")
            ),
            React.createElement("div", { className: "charts-list" },
              charts.length === 0 ? React.createElement("div", { className: "charts-empty" }, "No saved charts yet") : null,
              charts.map(function (m) {
                return React.createElement("div", { key: m.id, className: "chart-row" + (m.id === chart.id ? " active" : ""), onClick: function () { openChart(m.id); } },
                  React.createElement("div", { className: "chart-row-main" },
                    React.createElement("div", { className: "chart-row-name" }, m.name),
                    React.createElement("div", { className: "chart-row-meta" },
                      (m.audioName ? "♪ " : "○ ") + m.bpm + " BPM · " + m.tsNum + "/" + m.tsDen + " · " + m.noteCount + " notes")
                  ),
                  React.createElement("button", { className: "chart-del", title: "Delete", onClick: function (e) { e.stopPropagation(); deleteChartAction(m.id); } }, "✕")
                );
              })
            )
          ) : null
        ),
        React.createElement("div", { className: "spacer" }),
        !isMobile ? React.createElement("div", { className: "seg" },
          React.createElement("button", { className: mode === "edit" ? "on" : "", onClick: function () { setMode("edit"); } }, "Editor"),
          React.createElement("button", { className: mode === "play" ? "on" : "", onClick: function () { setMode("play"); } }, "Player")
        ) : null
      ),
      // body
      React.createElement("div", { className: "body" },
        React.createElement("div", { className: "stage" },
          React.createElement(HighwayCanvas, {
            chart: chart, mode: activeMode, tool: tool, snapEnabled: snapEnabled, snapDiv: snapDiv,
            chartType: chartType, showChordNames: showChordNames, chordHoverT: chordHoverT,
            getSongPos: getSongPos, onAddNote: addNote, onRemoveNote: removeNote,
            onChordPlace: onChordPlace, onChordEdit: onChordEdit, onChordHover: setChordHoverT,
            onScrub: isMobile ? scrubTransport : scrubEdit,
            allowScrub: isMobile,
            scrollSeconds: 3.7 - (spacing - 1) * (3.7 - 1.3) / 9
          }),
          // HUD
          React.createElement("div", { className: "hud" },
            React.createElement("div", { className: "pill" }, "BPM ", React.createElement("b", null, chart.bpm)),
            React.createElement("div", { className: "pill" }, React.createElement("b", null, S.tsNum(chart) + "/" + S.tsDen(chart))),
            React.createElement("div", { className: "pill" }, React.createElement("span", { className: "cy" }, activeMode === "edit" ? "EDIT" : "PLAY")),
            activeMode === "edit" ? React.createElement("div", { className: "pill" }, "Bar ", React.createElement("b", null, bar > 0 ? bar : "—")) : null,
            chartType === "chord" ? React.createElement("div", { className: "pill" }, "Key ", React.createElement("b", null, chart.songKey || "C")) : null,
            activeMode === "edit" && chartType !== "chord" ? React.createElement("button", {
              className: "hud-tool-cycle",
              onClick: cycleTool,
              title: "Cycle note tool (Tom → Cymbal → Kick)"
            },
              toolGlyph(tool),
              React.createElement("span", null, TOOL_LABELS[tool]),
              React.createElement("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: "currentColor", "aria-hidden": true },
                React.createElement("path", { d: "M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 0 1 6 12c0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2A5.87 5.87 0 0 1 18 12c0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z" })
              )
            ) : null
          ),
          !hasAudio ? React.createElement("div", { className: "empty" },
            React.createElement("h2", null, "Load a song to begin"),
            React.createElement("p", null, isMobile
              ? "Open this chart on a desktop browser to load audio and edit notes."
              : "Drop in an audio file, set the BPM, then drag the yellow marker on the waveform to line up the first downbeat. Switch to Editor to chart your notes."),
            !isMobile ? React.createElement("button", { className: "btn primary", onClick: function () { fileRef.current.click(); } }, "Choose audio file…") : null
          ) : null,
          isMobile ? React.createElement("div", { className: "mobile-controls" },
            React.createElement("div", { className: "mobile-controls-main" },
              React.createElement("button", { className: "btn icon ghost", title: "Back to start", onClick: stopToStart }, React.createElement(Icon, { name: "rewind" })),
              React.createElement("button", { className: "play-btn", title: "Play / Pause", onClick: togglePlay },
                React.createElement(Icon, { name: playing ? "pause" : "play", size: 20 })),
              React.createElement("div", { className: "mobile-time" },
                React.createElement("span", { className: "timecode" }, fmtTime(pos)),
                React.createElement("span", { className: "sep" }, " / "),
                React.createElement("span", { className: "dim" }, fmtTime(chart.duration)),
                React.createElement("span", { className: "mobile-bar" }, bar > 0 ? (bar + "." + beat) : "—.—")
              ),
              React.createElement("button", {
                className: "btn icon ghost mobile-opts-btn",
                title: "Chart & playback options",
                onClick: function () { setMobileOptsOpen(!mobileOptsOpen); }
              }, mobileOptsOpen ? "▾" : "⚙")
            ),
            mobileOptsOpen ? React.createElement("div", { className: "mobile-opts-panel" },
              React.createElement("div", { className: "mobile-opts-row" },
                React.createElement("span", { className: "mobile-opts-label" }, "Chart"),
                React.createElement("div", { className: "seg side-seg" },
                  React.createElement("button", { className: chartType === "drum" ? "on" : "", onClick: function () { setChartType("drum"); } }, "Drum"),
                  React.createElement("button", { className: chartType === "chord" ? "on" : "", onClick: function () { setChartType("chord"); } }, "Chord")
                )
              ),
              React.createElement("div", { className: "mobile-opts-row" },
                React.createElement("span", { className: "mobile-opts-label" }, "Show as"),
                React.createElement("div", { className: "seg side-seg" },
                  React.createElement("button", { className: !showChordNames ? "on" : "", onClick: function () { setShowChordNames(false); } }, "Numbers"),
                  React.createElement("button", { className: showChordNames ? "on" : "", onClick: function () { setShowChordNames(true); } }, "Chords")
                )
              ),
              React.createElement("div", { className: "mobile-opts-row" },
                React.createElement("span", { className: "mobile-opts-label" }, "Count-in"),
                React.createElement("div", { className: "switch" + (countInOn ? " on" : ""), onClick: function () { setCountInOn(!countInOn); } })
              ),
              React.createElement("div", { className: "mobile-opts-row" },
                React.createElement("span", { className: "mobile-opts-label" }, "Metronome"),
                React.createElement("div", { className: "switch" + (metro ? " on" : ""), onClick: function () { setMetro(!metro); } })
              ),
              React.createElement("div", { className: "mobile-opts-row" },
                React.createElement("span", { className: "mobile-opts-label" }, "Loop"),
                React.createElement("div", {
                  className: "switch" + (loopOn ? " on" : ""),
                  onClick: function () { if (loopA != null && loopB != null) setLoopOn(!loopOn); }
                })
              ),
              loopA != null && loopB != null ? React.createElement("div", { className: "mobile-opts-hint" },
                "Loop ", fmtTime(loopA), " – ", fmtTime(loopB)
              ) : null
            ) : null,
            React.createElement("div", { className: "mobile-controls-speed" },
              React.createElement("span", { className: "tlabel" }, "Speed"),
              React.createElement("input", { type: "range", min: 0.5, max: 1.5, step: 0.05, value: rate, onChange: function (e) { setRateSafe(parseFloat(e.target.value)); } }),
              React.createElement("span", { className: "timecode" }, rate.toFixed(2) + "×")
            )
          ) : null
        ),
        // side panel
        !isMobile ? React.createElement(SidePanel, {
          mode: activeMode, chart: chart, patchChart: patchChart, tool: tool, setTool: setTool,
          chartType: chartType, setChartType: setChartType, showChordNames: showChordNames, setShowChordNames: setShowChordNames,
          chordEdit: chordEdit, setChordEdit: setChordEdit, saveChordEdit: saveChordEdit, cancelChordEdit: cancelChordEdit, deleteChordEdit: deleteChordEdit,
          snapEnabled: snapEnabled, setSnapEnabled: setSnapEnabled, snapDiv: snapDiv, setSnapDiv: setSnapDiv,
          spacing: spacing, setSpacing: setSpacing,
          keyEntry: keyEntry, setKeyEntry: setKeyEntry, keymap: keymap, listenAction: listenAction,
          startListen: function (a) { setListenAction(a); }, clearListen: function () { setListenAction(null); },
          resetKeymap: function () { setKeymap(Object.assign({}, S.DEFAULT_KEYMAP)); },
          clearNotes: clearNotes, clearChordNotes: clearChordNotes, openFile: function () { fileRef.current.click(); }, hasAudio: hasAudio,
          rate: rate, setRate: setRateSafe, countInOn: countInOn, setCountInOn: setCountInOn,
          metro: metro, setMetro: setMetro,
          loopOn: loopOn, setLoopOn: setLoopOn, loopA: loopA, loopB: loopB,
          setLoopA: function () { setLoopA(getSongPos()); }, setLoopB: function () { setLoopB(getSongPos()); },
          clearLoop: function () { setLoopA(null); setLoopB(null); setLoopOn(false); },
          getPos: getSongPos
        }) : null
      ),
      // transport (desktop only)
      !isMobile ? React.createElement("div", { className: "transport" },
        React.createElement("div", { className: "overview-row" },
          React.createElement("span", { className: "overview-label" },
            chartType === "chord" ? "CHORDS" : "DRUMS"),
          React.createElement("canvas", { className: "mini-canvas", ref: miniRef, onPointerDown: onMiniDown })
        ),
        React.createElement("div", { className: "wave-row" },
          React.createElement("canvas", { className: "wave-canvas", ref: waveRef, onPointerDown: onWaveDown }),
          !hasAudio ? React.createElement("div", { className: "wave-empty" }, "waveform — load an audio file") : null
        ),
        React.createElement("div", { className: "tcontrols" },
          React.createElement("div", { className: "tgroup" },
            React.createElement("button", { className: "btn icon ghost", title: "Back to start (Enter)", onClick: stopToStart }, React.createElement(Icon, { name: "rewind" })),
            React.createElement("button", { className: "play-btn", title: "Play / Pause (Space)", onClick: togglePlay },
              React.createElement(Icon, { name: playing ? "pause" : "play", size: 20 }))
          ),
          React.createElement("div", { className: "timecode" },
            fmtTime(pos),
            React.createElement("span", { className: "sep" }, " / "),
            React.createElement("span", { className: "dim" }, fmtTime(chart.duration)),
            React.createElement("span", { className: "sep" }, "   "),
            React.createElement("span", null, bar > 0 ? (bar + "." + beat) : "—.—")
          ),
          React.createElement("div", { className: "tgroup" },
            React.createElement("span", { className: "tlabel" }, "Speed"),
            React.createElement("input", { type: "range", min: 0.5, max: 1.5, step: 0.05, value: rate, style: { width: 110 }, onChange: function (e) { setRateSafe(parseFloat(e.target.value)); } }),
            React.createElement("span", { className: "timecode", style: { minWidth: 42 } }, rate.toFixed(2) + "×")
          ),
          React.createElement("div", { className: "tgroup" },
            React.createElement("button", { className: "btn " + (countInOn ? "on" : ""), onClick: function () { setCountInOn(!countInOn); }, title: "Count-in before playback" }, "Count-in"),
            React.createElement("button", { className: "btn " + (metro ? "on" : ""), onClick: function () { setMetro(!metro); }, title: "Metronome click" }, "Metronome")
          ),
          React.createElement("div", { className: "tgroup" },
            React.createElement("span", { className: "tlabel" }, "Loop"),
            React.createElement("button", { className: "btn", onClick: function () { setLoopA(getSongPos()); }, title: "Set loop start" }, "A ", React.createElement("span", { style: { color: "var(--muted-2)", fontFamily: "var(--mono)", fontSize: 11 } }, loopA != null ? fmtTime(loopA) : "—")),
            React.createElement("button", { className: "btn", onClick: function () { setLoopB(getSongPos()); }, title: "Set loop end" }, "B ", React.createElement("span", { style: { color: "var(--muted-2)", fontFamily: "var(--mono)", fontSize: 11 } }, loopB != null ? fmtTime(loopB) : "—")),
            React.createElement("button", { className: "btn " + (loopOn ? "on" : ""), onClick: function () { setLoopOn(!loopOn); }, disabled: loopA == null || loopB == null }, "Loop")
          )
        )
      ) : null,
      // statusbar (desktop only)
      !isMobile ? React.createElement("div", { className: "statusbar" },
        React.createElement("span", null, React.createElement("span", { className: "dot" + (hasAudio ? "" : " off") }), " ", hasAudio ? (chart.audioName || "audio loaded") : "no audio"),
        React.createElement("span", null, chart.notes.length + " notes"),
        React.createElement("span", null, "snap " + (snapEnabled ? SNAP_OPTS.find(function (o) { return o.div === snapDiv; }).label : "off")),
        loopOn && loopA != null && loopB != null ? React.createElement("span", { className: "loop-tag" }, "loop " + fmtTime(loopA) + "–" + fmtTime(loopB)) : null,
        React.createElement("div", { className: "spacer", style: { flex: 1 } }),
        S.isCloudMode() ? React.createElement(React.Fragment, null,
          hasDraft ? React.createElement("button", {
            className: "btn primary", style: { padding: "4px 12px", fontSize: 12 },
            disabled: syncing, onClick: saveToCloudNow
          }, syncing ? "Saving…" : "Save to cloud") : null,
          React.createElement("span", null,
            hasDraft ? "unsynced draft" : "synced to cloud")
        ) : React.createElement("span", null, "saved locally")
      ) : null,
      React.createElement("input", {
        ref: fileRef, type: "file", accept: "audio/*", className: "file-input",
        onChange: function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; }
      })
    );
  }
