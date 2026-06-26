// @ts-nocheck
"use client";

/* WorshipAssist — Highway canvas (React component) */
import React, { useRef, useEffect } from "react";
import { DAStore } from "./da-store";
import { formatChordDisplay } from "@/lib/nns";

export const DA_LANE_COLORS = ["#e2483b", "#e8c020", "#2f86ea", "#33ad52"]; // red, yellow, blue, green
export const DA_KICK_COLOR = "#ef8a17";
const LANE_COLORS = DA_LANE_COLORS;
const KICK_COLOR = DA_KICK_COLOR;
const GREY = "#3a3b41";
export const DA_CHORD_COLOR = "#a82e24";
const CHORD_COLOR = DA_CHORD_COLOR;

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function darken(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, r * (1 - amt));
    g = Math.max(0, g * (1 - amt));
    b = Math.max(0, b * (1 - amt));
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }

  function laneNoteColor(lane, kind, crossed) {
    if (crossed) return GREY;
    const base = LANE_COLORS[lane];
    return kind === "cymbal" ? darken(base, 0.22) : base;
  }

  // Snap a time to the nearest grid line. snapDiv = subdivisions per beat.
  function snapTime(t, spb, offset, snapDiv) {
    const step = spb / snapDiv;      // seconds per grid line
    const k = Math.round((t - offset) / step);
    return offset + k * step;
  }

  function isKickNote(n) {
    return n.lane === -1 || n.kind === "kick";
  }

  function sortByTimeFarToNear(notes) {
    return notes.slice().sort(function (a, b) { return b.t - a.t; });
  }

  function screenToTime(mx, my, g, songPos) {
    let s = 1 - (g.strikeY - my) / (g.strikeY - g.horizonY);
    if (s <= 0.02) s = 0.02;
    const z = (1 / s) - 1;
    return songPos + z / g.speed;
  }

  function chordLabel(n, chart, showChordNames) {
    return formatChordDisplay(n.nashville, chart.songKey || "C", !!showChordNames);
  }

  function activeChordAt(songPos, chordNotes) {
    const sorted = (chordNotes || []).slice().sort(function (a, b) { return a.t - b.t; });
    let active = null;
    for (const n of sorted) {
      if (n.t <= songPos + 0.001) active = n;
      else break;
    }
    return active;
  }

  function chartStartTime(chart) {
    return chart.chartStart ?? 0;
  }

  function inChartRange(n, chart) {
    return n.t >= chartStartTime(chart) - 0.001;
  }

  export function HighwayCanvas(props: Record<string, unknown>) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const propsRef = useRef(props);
    propsRef.current = props;

    const flashesRef = useRef([]);       // {t0(ctxOrPerf), lane, kind}
    const lastPosRef = useRef(0);
    const geomRef = useRef(null);
    const rafRef = useRef(0);
    const hoverRef = useRef(null);       // {t, lane, kind} preview while editing
    const scrubDragRef = useRef(null);   // {startY, startT, id} finger scrub on mobile

    function resolvePlacement(scLane, tool) {
      if (tool === "kick") return { lane: -1, kind: "kick" };
      if (scLane === 0) return { lane: 0, kind: "snare" };
      return { lane: scLane, kind: tool === "cymbal" ? "cymbal" : "tom" };
    }

    // ---- geometry ----
    function computeGeom(W, H) {
      const cx = W / 2;
      const strikeY = H * 0.80;
      const horizonY = H * 0.05;
      const Wfull = Math.min(W * 0.88, 720);
      const L = propsRef.current.scrollSeconds || 2.2;
      const minS = 0.12;
      const zL = (1 / minS) - 1;
      const speed = zL / L;            // track units per second
      const laneW = Wfull / 4;
      const baseR = laneW * 0.32;
      return { W, H, cx, strikeY, horizonY, Wfull, speed, laneW, baseR, L };
    }

    function sFor(dt, g) {
      const z = dt * g.speed;
      return 1 / (1 + z);
    }
    // Past notes where scale would go non-positive must be culled (depends on scroll speed).
    function pastLimit(g) {
      return Math.max(-0.24, -0.95 / g.speed);
    }
    function noteVisible(dt, g) {
      return dt > pastLimit(g) && dt <= g.L + 0.05;
    }
    function safeScale(s) {
      if (!isFinite(s) || s <= 0) return 0.12;
      return s;
    }
    function yFor(s, g) {
      return g.strikeY - (g.strikeY - g.horizonY) * (1 - s);
    }
    function laneCenterX(lane, s, g) {
      const frac = (lane + 0.5) / 4 - 0.5;
      return g.cx + frac * g.Wfull * s;
    }

    // invert screen point -> {t, lane}
    function screenToChart(mx, my, g, songPos) {
      let s = 1 - (g.strikeY - my) / (g.strikeY - g.horizonY);
      if (s <= 0.02) s = 0.02;
      const z = (1 / s) - 1;
      const dt = z / g.speed;
      const t = songPos + dt;
      const frac = (mx - g.cx) / (g.Wfull * s) + 0.5;
      let lane = Math.floor(frac * 4);
      if (lane < 0) lane = 0; if (lane > 3) lane = 3;
      return { t, lane, s, frac };
    }

    // ---- drawing ----
    function draw() {
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = computeGeom(W, H);
      geomRef.current = g;
      const P = propsRef.current;
      const songPos = P.getSongPos();

      const isChord = P.chartType === "chord";
      const chordNotes = (P.chart.chordNotes || []).filter(function (n) { return inChartRange(n, P.chart); });
      const drumNotes = P.chart.notes.filter(function (n) { return inChartRange(n, P.chart); });

      // detect crossings for flash (player + edit preview)
      const prev = lastPosRef.current;
      if (songPos > prev) {
        if (isChord) {
          for (const n of chordNotes) {
            if (n.t > prev && n.t <= songPos) {
              flashesRef.current.push({ t0: performance.now(), kind: "chord" });
            }
          }
        } else {
          for (const n of drumNotes) {
            if (n.t > prev && n.t <= songPos) {
              flashesRef.current.push({ t0: performance.now(), lane: n.lane, kind: n.kind });
            }
          }
        }
      }
      lastPosRef.current = songPos;

      // bg
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#16171a";
      ctx.fillRect(0, 0, W, H);

      // highway surface — converges to the SAME vanishing point as the notes,
      // so lane edges and note columns share one perspective.
      const sBottom = (g.H - g.horizonY) / (g.strikeY - g.horizonY); // s at screen bottom
      const VPx = g.cx, VPy = g.horizonY;
      function laneXbottom(frac) { return g.cx + frac * g.Wfull * sBottom; }
      ctx.beginPath();
      ctx.moveTo(laneXbottom(-0.5), g.H);
      ctx.lineTo(laneXbottom(0.5), g.H);
      ctx.lineTo(VPx, VPy);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, g.horizonY, 0, g.H);
      grad.addColorStop(0, "#1b1c20");
      grad.addColorStop(1, "#202227");
      ctx.fillStyle = grad;
      ctx.fill();

      // lane tints (drum only)
      if (!isChord) {
        for (let i = 0; i < 4; i++) {
          const lx0 = (i / 4 - 0.5), lx1 = ((i + 1) / 4 - 0.5);
          ctx.beginPath();
          ctx.moveTo(laneXbottom(lx0), g.H);
          ctx.lineTo(laneXbottom(lx1), g.H);
          ctx.lineTo(VPx, VPy);
          ctx.closePath();
          ctx.fillStyle = hexA(LANE_COLORS[i], 0.05);
          ctx.fill();
        }
      }

      // beat grid lines
      const offset = P.chart.offset, bpb = DAStore.tsNum(P.chart);
      const spb = DAStore.secPerBeat(P.chart);
      const div = P.snapDiv || 1;
      const step = spb / div;
      const startT = songPos - 0.3;
      const endT = songPos + g.L;
      let k0 = Math.ceil((startT - offset) / step);
      for (let k = k0; ; k++) {
        const t = offset + k * step;
        if (t > endT) break;
        const dt = t - songPos;
        if (dt <= pastLimit(g)) continue;
        const s = sFor(dt, g);
        const y = yFor(s, g);
        const lx = g.cx - 0.5 * g.Wfull * s;
        const rx = g.cx + 0.5 * g.Wfull * s;
        const onBeat = Math.abs((t - offset) / spb - Math.round((t - offset) / spb)) < 0.001;
        const beatIndex = Math.round((t - offset) / spb);
        const onBar = onBeat && DAStore.isBarStart(P.chart, beatIndex);
        ctx.beginPath();
        ctx.moveTo(lx, y); ctx.lineTo(rx, y);
        ctx.lineWidth = onBar ? 2 : 1;
        ctx.strokeStyle = onBar ? hexA("#aeb6c2", 0.32 * s + 0.05)
          : onBeat ? hexA("#8b93a0", 0.22 * s + 0.03)
            : hexA("#6b7280", 0.12 * s + 0.02);
        ctx.stroke();
      }

      // lane divider lines (drum only)
      if (!isChord) {
        for (let i = 0; i <= 4; i++) {
          const frac = i / 4 - 0.5;
          ctx.beginPath();
          ctx.moveTo(laneXbottom(frac), g.H);
          ctx.lineTo(VPx, VPy);
          ctx.lineWidth = (i === 0 || i === 4) ? 2 : 1;
          ctx.strokeStyle = hexA("#4a4d55", 0.9);
          ctx.stroke();
        }
      }

      drawStrike(ctx, g);

      if (isChord) {
        for (const n of sortByTimeFarToNear(chordNotes)) {
          const dt = n.t - songPos;
          if (!noteVisible(dt, g)) continue;
          const s = safeScale(sFor(dt, g));
          const y = yFor(s, g);
          const crossed = dt <= 0;
          drawChordBar(ctx, n, s, y, g, crossed, !crossed, P);
        }
        const active = activeChordAt(songPos, chordNotes);
        if (active) {
          drawStickyChordLabel(ctx, g, chordLabel(active, P.chart, P.showChordNames));
        }
        if (P.mode === "edit" && P.chordHoverT != null) {
          const dt = P.chordHoverT - songPos;
          if (noteVisible(dt, g)) {
            const s = safeScale(sFor(dt, g));
            const y = yFor(s, g);
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.setLineDash([5, 4]);
            drawChordBar(ctx, { nashville: "?" }, s, y, g, false, false, P);
            ctx.restore();
          }
        }
      } else {
        function drawVisibleNotes(list) {
          for (const n of sortByTimeFarToNear(list)) {
            const dt = n.t - songPos;
            if (!noteVisible(dt, g)) continue;
            const s = safeScale(sFor(dt, g));
            const y = yFor(s, g);
            drawNote(ctx, n, s, y, g, dt <= 0);
          }
        }
        const all = drumNotes;
        drawVisibleNotes(all.filter(isKickNote));
        drawVisibleNotes(all.filter(function (n) { return !isKickNote(n); }));

        if (P.mode === "edit" && hoverRef.current) {
          const h = hoverRef.current;
          const dt = h.t - songPos;
          if (noteVisible(dt, g)) {
            if (h.lane >= 0) {
              const i = h.lane;
              ctx.beginPath();
              ctx.moveTo(laneXbottom(i / 4 - 0.5), g.H);
              ctx.lineTo(laneXbottom((i + 1) / 4 - 0.5), g.H);
              ctx.lineTo(VPx, VPy);
              ctx.closePath();
              ctx.fillStyle = hexA(LANE_COLORS[i], 0.10);
              ctx.fill();
            }
            const s = safeScale(sFor(dt, g));
            const y = yFor(s, g);
            ctx.save();
            ctx.globalAlpha = 0.4;
            ctx.setLineDash([5, 4]);
            drawNote(ctx, h, s, y, g);
            ctx.restore();
          }
        }
      }

      // flashes
      const now = performance.now();
      flashesRef.current = flashesRef.current.filter(f => now - f.t0 < 240);
      for (const f of flashesRef.current) {
        const age = (now - f.t0) / 240;
        drawFlash(ctx, f, age, g);
      }

      // edit playhead label handled by overlay DOM
      rafRef.current = requestAnimationFrame(draw);
    }

    function drawChordBar(ctx, n, s, y, g, crossed, showLabel, P) {
      s = safeScale(s);
      const lx = g.cx - 0.5 * g.Wfull * s, w = g.Wfull * s;
      const h = Math.max(10, 22 * s);
      const color = crossed ? GREY : CHORD_COLOR;
      ctx.save();
      ctx.shadowColor = hexA(color, crossed ? 0.15 : 0.45);
      ctx.shadowBlur = 10 * s;
      roundRect(ctx, lx, y - h / 2, w, h, h / 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      if (showLabel && n.nashville) {
        const label = chordLabel(n, P.chart, P.showChordNames);
        const fontSize = Math.max(36, 80 * s);
        ctx.save();
        ctx.font = "700 " + fontSize + "px IBM Plex Sans, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,.35)";
        ctx.shadowBlur = 4;
        ctx.fillText(label, g.cx, y);
        ctx.restore();
      }
    }

    function drawStickyChordLabel(ctx, g, label) {
      const y = g.strikeY;
      const lx = g.cx - 0.5 * g.Wfull;
      const w = g.Wfull;
      const h = 36;
      ctx.save();
      roundRect(ctx, lx, y - h / 2, w, h, 8);
      ctx.fillStyle = CHORD_COLOR;
      ctx.shadowColor = hexA(CHORD_COLOR, 0.5);
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.font = "700 72px IBM Plex Sans, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,.35)";
      ctx.shadowBlur = 6;
      ctx.fillText(label, g.cx, y);
      ctx.restore();
    }

    function drawStrike(ctx, g) {
      const y = g.strikeY;
      const lx = g.cx - 0.5 * g.Wfull, rx = g.cx + 0.5 * g.Wfull;
      ctx.save();
      ctx.shadowColor = hexA("#36c6da", 0.7);
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(lx, y); ctx.lineTo(rx, y);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#36c6da";
      ctx.stroke();
      ctx.restore();
    }

    function drawNote(ctx, n, s, y, g, crossed) {
      s = safeScale(s);
      const r = Math.max(1, g.baseR * s);
      const kickColor = crossed ? GREY : KICK_COLOR;
      if (n.lane === -1 || n.kind === "kick") {
        // kick bar across all lanes (drawn before lane notes so they stack on top)
        const lx = g.cx - 0.5 * g.Wfull * s, w = g.Wfull * s;
        const h = Math.max(8, 18 * s);
        ctx.save();
        ctx.shadowColor = hexA(kickColor, crossed ? 0.2 : 0.5);
        ctx.shadowBlur = 10 * s;
        roundRect(ctx, lx, y - h / 2, w, h, h / 2);
        ctx.fillStyle = kickColor;
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = hexA("#ffffff", crossed ? 0.25 * s : 0.5 * s);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        return;
      }
      const color = laneNoteColor(n.lane, n.kind, crossed);
      const cxl = laneCenterX(n.lane, s, g);
      ctx.save();
      ctx.shadowColor = hexA(color, crossed ? 0.15 : 0.55);
      ctx.shadowBlur = 12 * s;
      if (n.kind === "cymbal") {
        // diamond
        ctx.beginPath();
        ctx.moveTo(cxl, y - r); ctx.lineTo(cxl + r, y);
        ctx.lineTo(cxl, y + r); ctx.lineTo(cxl - r, y);
        ctx.closePath();
      } else {
        // circle (snare / tom)
        ctx.beginPath();
        ctx.arc(cxl, y, r, 0, Math.PI * 2);
      }
      const fill = ctx.createLinearGradient(cxl, y - r, cxl, y + r);
      const hi = n.kind === "cymbal" ? 0.12 : 0.25;
      fill.addColorStop(0, crossed ? lighten(GREY, 0.15) : lighten(color, hi));
      fill.addColorStop(1, color);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 1.5 * s + 0.5;
      ctx.strokeStyle = hexA("#ffffff", crossed ? 0.3 : 0.7);
      ctx.stroke();
    }

    function drawFlash(ctx, f, age, g) {
      const alpha = (1 - age) * 0.8;
      if (f.kind === "chord") {
        const lx = g.cx - 0.5 * g.Wfull, w = g.Wfull;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = hexA(CHORD_COLOR, 0.55);
        ctx.fillRect(lx, g.strikeY - 14, w, 28);
        ctx.restore();
        return;
      }
      if (f.lane === -1 || f.kind === "kick") {
        const lx = g.cx - 0.5 * g.Wfull, w = g.Wfull;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = hexA(KICK_COLOR, 0.5);
        ctx.fillRect(lx, g.strikeY - 10, w, 20);
        ctx.restore();
        return;
      }
      const color = laneNoteColor(f.lane, f.kind, false);
      const cxl = laneCenterX(f.lane, 1, g);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cxl, g.strikeY, g.baseR * (1 + age * 1.4), 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 * (1 - age) + 1;
      ctx.stroke();
      // lane wash
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = hexA(color, 0.4);
      ctx.beginPath();
      ctx.arc(cxl, g.strikeY, g.baseR * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function lighten(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      r = Math.min(255, r + 255 * amt); g = Math.min(255, g + 255 * amt); b = Math.min(255, b + 255 * amt);
      return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
    }

    // ---- pointer interaction ----
    function onPointerDown(e) {
      const P = propsRef.current;
      if (e.button !== 0) return;

      if (P.allowScrub && P.mode === "play") {
        scrubDragRef.current = { startY: e.clientY, startT: P.getSongPos(), id: e.pointerId };
        canvasRef.current.setPointerCapture(e.pointerId);
        return;
      }

      if (P.mode !== "edit") return;
      const g = geomRef.current;
      if (!g) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const songPos = P.getSongPos();
      const startT = chartStartTime(P.chart);

      if (P.chartType === "chord") {
        let hit = null, hitD = 1e9;
        for (const n of (P.chart.chordNotes || [])) {
          const dt = n.t - songPos;
          if (!noteVisible(dt, g)) continue;
          const s = safeScale(sFor(dt, g));
          const y = yFor(s, g);
          if (Math.abs(my - y) < Math.max(12, 14 * s)) {
            const d = Math.abs(my - y);
            if (d < hitD) { hitD = d; hit = n; }
          }
        }
        if (hit) { P.onChordEdit(hit); return; }
        let t = screenToTime(mx, my, g, songPos);
        if (t < startT) return;
        if (P.snapEnabled) t = snapTime(t, DAStore.secPerBeat(P.chart), P.chart.offset, P.snapDiv);
        if (t < startT) t = startT;
        P.onChordPlace(t);
        return;
      }

      // hit test existing notes -> remove (lane notes before kicks when stacked)
      let hit = null, hitD = 1e9;
      function testNote(n) {
        const dt = n.t - songPos;
        if (dt <= pastLimit(g) || dt > g.L + 0.05) return;
        const s = sFor(dt, g);
        const y = yFor(s, g);
        if (isKickNote(n)) {
          if (Math.abs(my - y) < Math.max(10, 12 * s)) {
            const d = Math.abs(my - y); if (d < hitD) { hitD = d; hit = n; }
          }
        } else {
          const cxl = laneCenterX(n.lane, s, g);
          const r = g.baseR * s;
          const d = Math.hypot(mx - cxl, my - y);
          if (d < r + 5 && d < hitD) { hitD = d; hit = n; }
        }
      }
      for (const n of P.chart.notes) { if (!isKickNote(n)) testNote(n); }
      for (const n of P.chart.notes) { if (isKickNote(n)) testNote(n); }
      if (hit) { P.onRemoveNote(hit.id); return; }

      // place new
      const sc = screenToChart(mx, my, g, songPos);
      let t = sc.t;
      if (t < startT) return;
      if (P.snapEnabled) t = snapTime(t, DAStore.secPerBeat(P.chart), P.chart.offset, P.snapDiv);
      if (t < startT) t = startT;
      const pl = resolvePlacement(sc.lane, P.tool);
      P.onAddNote({ t: t, lane: pl.lane, kind: pl.kind });
    }

    function onPointerUp(e) {
      if (scrubDragRef.current && scrubDragRef.current.id === e.pointerId) {
        scrubDragRef.current = null;
      }
    }

    function onPointerMove(e) {
      const P = propsRef.current;
      const drag = scrubDragRef.current;
      if (drag && drag.id === e.pointerId) {
        const dy = e.clientY - drag.startY;
        P.onScrub(Math.max(0, drag.startT + dy * 0.004));
        return;
      }
      if (P.mode !== "edit") { hoverRef.current = null; return; }
      const g = geomRef.current;
      if (!g) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const songPos = P.getSongPos();
      if (P.chartType === "chord") {
        let t = screenToTime(mx, my, g, songPos);
        if (t < 0) { if (P.onChordHover) P.onChordHover(null); return; }
        if (P.snapEnabled) t = snapTime(t, DAStore.secPerBeat(P.chart), P.chart.offset, P.snapDiv);
        if (P.onChordHover) P.onChordHover(Math.max(0, t));
        return;
      }
      const sc = screenToChart(mx, my, g, songPos);
      let t = sc.t;
      if (t < 0) { hoverRef.current = null; return; }
      if (P.snapEnabled) t = snapTime(t, DAStore.secPerBeat(P.chart), P.chart.offset, P.snapDiv);
      if (t < 0) t = 0;
      const pl = resolvePlacement(sc.lane, P.tool);
      hoverRef.current = { t: t, lane: pl.lane, kind: pl.kind };
    }
    function onPointerLeave() {
      hoverRef.current = null;
      if (propsRef.current.onChordHover) propsRef.current.onChordHover(null);
    }

    function onWheel(e) {
      const P = propsRef.current;
      const canScrub = P.mode === "edit" || (P.allowScrub && P.mode === "play");
      if (!canScrub) return;
      e.preventDefault();
      const delta = (e.deltaY) * 0.0016;
      P.onScrub(Math.max(0, P.getSongPos() + delta));
    }

    useEffect(function () {
      const cv = canvasRef.current;
      cv.addEventListener("pointerdown", onPointerDown);
      cv.addEventListener("pointermove", onPointerMove);
      cv.addEventListener("pointerup", onPointerUp);
      cv.addEventListener("pointercancel", onPointerUp);
      cv.addEventListener("pointerleave", onPointerLeave);
      cv.addEventListener("wheel", onWheel, { passive: false });
      rafRef.current = requestAnimationFrame(draw);
      return function () {
        cv.removeEventListener("pointerdown", onPointerDown);
        cv.removeEventListener("pointermove", onPointerMove);
        cv.removeEventListener("pointerup", onPointerUp);
        cv.removeEventListener("pointercancel", onPointerUp);
        cv.removeEventListener("pointerleave", onPointerLeave);
        cv.removeEventListener("wheel", onWheel);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }, []);

    return React.createElement("div", { className: "hw-wrap", ref: wrapRef },
      React.createElement("canvas", { ref: canvasRef, className: "hw-canvas" })
    );
  }
