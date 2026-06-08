// @ts-nocheck
"use client";

/* DrumAssist — Side panel (Editor + Player settings) */
import React from "react";
import { DAStore } from "./da-store";
import { DA_LANE_COLORS, DA_KICK_COLOR } from "./da-highway";

const LANE_COLORS = DA_LANE_COLORS;
const KICK_COLOR = DA_KICK_COLOR;
  const SNAP_OPTS = [
    { div: 1, label: "1/4" }, { div: 2, label: "1/8" },
    { div: 4, label: "1/16" }, { div: 3, label: "trip" }
  ];

  function NumField(p) {
    return React.createElement("div", { className: "field" },
      React.createElement("label", null, p.label),
      React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
        p.onStep ? React.createElement("button", { className: "btn icon ghost", style: { padding: "4px 8px" }, onClick: function () { p.onStep(-(p.step || 1)); } }, "−") : null,
        React.createElement("input", {
          className: "num", type: "number", value: p.value, step: p.step || 1,
          onChange: function (e) { p.onChange(parseFloat(e.target.value)); }
        }),
        p.onStep ? React.createElement("button", { className: "btn icon ghost", style: { padding: "4px 8px" }, onClick: function () { p.onStep(p.step || 1); } }, "+") : null
      )
    );
  }

  function ToolBtn(p) {
    return React.createElement("div", { className: "tool" + (p.on ? " on" : ""), onClick: p.onClick },
      React.createElement("span", { className: "glyph" }, p.glyph),
      React.createElement("span", { className: "tname" }, p.name),
      React.createElement("span", { className: "thint" }, p.hint)
    );
  }

  function glyphCircle(color) {
    return React.createElement("svg", { viewBox: "0 0 22 22", width: 20, height: 20 },
      React.createElement("circle", { cx: 11, cy: 11, r: 8, fill: color }));
  }
  function glyphDiamond(color) {
    return React.createElement("svg", { viewBox: "0 0 22 22", width: 20, height: 20 },
      React.createElement("polygon", { points: "11,2 20,11 11,20 2,11", fill: color }));
  }
  function glyphBar(color) {
    return React.createElement("svg", { viewBox: "0 0 22 22", width: 20, height: 20 },
      React.createElement("rect", { x: 1, y: 8, width: 20, height: 6, rx: 3, fill: color }));
  }

  function Switch(p) {
    return React.createElement("div", { className: "switch" + (p.on ? " on" : ""), onClick: p.onClick });
  }

  function TimeSigField(p) {
    const num = DAStore.tsNum(p.chart);
    const den = DAStore.tsDen(p.chart);
    return React.createElement("div", { className: "field" },
      React.createElement("label", null, "Time signature"),
      React.createElement("div", { className: "tsig" },
        React.createElement("input", {
          className: "num tsnum", type: "number", min: 1, max: 16, value: num,
          onChange: function (e) { const v = Math.max(1, Math.min(16, Math.round(parseFloat(e.target.value) || 4))); p.patchChart({ tsNum: v, beatsPerBar: v }); }
        }),
        React.createElement("span", { className: "tsslash" }, "/"),
        React.createElement("select", {
          className: "tsden", value: den,
          onChange: function (e) { p.patchChart({ tsDen: parseInt(e.target.value, 10) }); }
        }, [2, 4, 8, 16].map(function (d) { return React.createElement("option", { key: d, value: d }, d); }))
      )
    );
  }

  const KEY_ROWS = [
    { a: "snare", label: "Snare", ci: 0, shape: "c" },
    { a: "tom1", label: "Tom · yellow", ci: 1, shape: "c" },
    { a: "cym1", label: "Cymbal · yellow", ci: 1, shape: "d" },
    { a: "tom2", label: "Tom · blue", ci: 2, shape: "c" },
    { a: "cym2", label: "Cymbal · blue", ci: 2, shape: "d" },
    { a: "tom3", label: "Tom · green", ci: 3, shape: "c" },
    { a: "cym3", label: "Cymbal · green", ci: 3, shape: "d" },
    { a: "kick", label: "Kick", ci: -1, shape: "b" }
  ];
  function keyLabel(k) { return k === "space" ? "Space" : (k ? k.toUpperCase() : "—"); }
  function rowGlyph(r) {
    const color = r.ci === -1 ? KICK_COLOR : LANE_COLORS[r.ci];
    if (r.shape === "d") return glyphDiamond(color);
    if (r.shape === "b") return glyphBar(color);
    return glyphCircle(color);
  }
  function KeyEntrySec(p) {
    return React.createElement("div", { className: "side-sec", key: "keyentry" },
      React.createElement("h3", null, "Live key entry"),
      React.createElement("div", { className: "toggle-row" },
        React.createElement("span", { style: { color: "var(--muted)", fontSize: 13 } }, "Record key hits"),
        React.createElement(Switch, { on: p.keyEntry, onClick: function () { p.setKeyEntry(!p.keyEntry); } })
      ),
      React.createElement("div", { className: "hint", style: { marginBottom: 10 } },
        "Press ", React.createElement("kbd", null, "Space"), " to play, then tap these keys in time — notes drop at the playhead (snapped if grid snap is on)."),
      React.createElement("div", { className: "keymap" },
        KEY_ROWS.map(function (r) {
          const listening = p.listenAction === r.a;
          return React.createElement("div", { className: "keyrow", key: r.a },
            React.createElement("span", { className: "keyglyph" }, rowGlyph(r)),
            React.createElement("span", { className: "keyname" }, r.label),
            React.createElement("button", {
              className: "keybtn" + (listening ? " listening" : ""),
              onClick: function () { listening ? p.clearListen() : p.startListen(r.a); }
            }, listening ? "press key…" : keyLabel(p.keymap[r.a]))
          );
        })
      ),
      React.createElement("button", { className: "btn ghost", style: { width: "100%", justifyContent: "center", marginTop: 8 }, onClick: p.resetKeymap }, "Reset to defaults")
    );
  }

  function SpacingSec(p) {
    const lab = p.spacing >= 8 ? "Far apart" : p.spacing <= 3 ? "Close" : "Medium";
    return React.createElement("div", { className: "side-sec", key: "spacing" },
      React.createElement("h3", null, "Highway"),
      React.createElement("div", { className: "field full" },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between" } },
          React.createElement("span", { style: { color: "var(--muted)", fontSize: 13 } }, "Note spacing"),
          React.createElement("span", { className: "timecode", style: { fontSize: 12 } }, lab)
        ),
        React.createElement("input", { type: "range", min: 1, max: 10, step: 1, value: p.spacing, onChange: function (e) { p.setSpacing(parseInt(e.target.value, 10)); } }),
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-2)", marginTop: 2 } },
          React.createElement("span", null, "closer"), React.createElement("span", null, "farther"))
      )
    );
  }

  export function SidePanel(p: Record<string, unknown>) {
    if (p.mode === "edit") {
      return React.createElement("div", { className: "side" },
        // song
        React.createElement("div", { className: "side-sec" },
          React.createElement("h3", null, "Song"),
          React.createElement("button", { className: "btn", style: { width: "100%", justifyContent: "center", marginBottom: 12 }, onClick: p.openFile },
            p.hasAudio ? "Replace audio…" : "Load audio…"),
          React.createElement(NumField, { label: "BPM", value: p.chart.bpm, step: 1, onChange: function (v) { if (v > 0) p.patchChart({ bpm: Math.round(v) }); }, onStep: function (d) { p.patchChart({ bpm: Math.max(20, p.chart.bpm + d) }); } }),
          React.createElement(NumField, { label: "First beat (s)", value: +p.chart.offset.toFixed(3), step: 0.01, onChange: function (v) { p.patchChart({ offset: Math.max(0, v || 0) }); }, onStep: function (d) { p.patchChart({ offset: Math.max(0, +(p.chart.offset + d).toFixed(3)) }); } }),
          React.createElement(TimeSigField, { chart: p.chart, patchChart: p.patchChart }),
          React.createElement("div", { className: "hint", style: { marginTop: 4 } }, "Tip: drag the yellow marker on the waveform to set the first downbeat.")
        ),
        // tools
        React.createElement("div", { className: "side-sec" },
          React.createElement("h3", null, "Note tool"),
          React.createElement("div", { className: "tools" },
            React.createElement(ToolBtn, { on: p.tool === "tom", onClick: function () { p.setTool("tom"); }, glyph: glyphCircle(LANE_COLORS[2]), name: "Tom", hint: "circle" }),
            React.createElement(ToolBtn, { on: p.tool === "cymbal", onClick: function () { p.setTool("cymbal"); }, glyph: glyphDiamond(LANE_COLORS[2]), name: "Cymbal", hint: "diamond" }),
            React.createElement(ToolBtn, { on: p.tool === "kick", onClick: function () { p.setTool("kick"); }, glyph: glyphBar(KICK_COLOR), name: "Kick", hint: "all lanes" })
          ),
          React.createElement("div", { className: "hint", style: { marginTop: 10 } }, "Click the ", React.createElement("b", { style: { color: LANE_COLORS[0] } }, "red"), " lane for snare. Yellow/blue/green place the selected tool. Click a note to delete it.")
        ),
        // snap
        React.createElement("div", { className: "side-sec" },
          React.createElement("h3", null, "Grid snap"),
          React.createElement("div", { className: "toggle-row" },
            React.createElement("span", { style: { color: "var(--muted)", fontSize: 13 } }, p.snapEnabled ? "Snap to grid" : "Free-hand"),
            React.createElement(Switch, { on: p.snapEnabled, onClick: function () { p.setSnapEnabled(!p.snapEnabled); } })
          ),
          React.createElement("div", { className: "chips" },
            SNAP_OPTS.map(function (o) {
              return React.createElement("div", { key: o.div, className: "chip" + (p.snapDiv === o.div ? " on" : ""), onClick: function () { p.setSnapDiv(o.div); } }, o.label);
            })
          )
        ),
        SpacingSec(p),
        KeyEntrySec(p),
        legendSec(),
        React.createElement("div", { className: "side-sec" },
          React.createElement("button", { className: "btn", style: { width: "100%", justifyContent: "center" }, onClick: p.clearNotes }, "Clear all notes")
        )
      );
    }
    // PLAYER
    return React.createElement("div", { className: "side" },
      React.createElement("div", { className: "side-sec" },
        React.createElement("h3", null, "Practice speed"),
        React.createElement("div", { className: "field full" },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between" } },
            React.createElement("span", { style: { color: "var(--muted)", fontSize: 13 } }, "Tempo"),
            React.createElement("span", { className: "timecode" }, p.rate.toFixed(2) + "×")
          ),
          React.createElement("input", { type: "range", min: 0.5, max: 1.5, step: 0.05, value: p.rate, onChange: function (e) { p.setRate(parseFloat(e.target.value)); } })
        ),
        React.createElement("div", { className: "chips" },
          [0.5, 0.75, 1, 1.25].map(function (r) {
            return React.createElement("div", { key: r, className: "chip" + (Math.abs(p.rate - r) < 0.001 ? " on" : ""), onClick: function () { p.setRate(r); } }, r + "×");
          })
        )
      ),
      React.createElement("div", { className: "side-sec" },
        React.createElement("h3", null, "Playback"),
        React.createElement("div", { className: "toggle-row" },
          React.createElement("span", { style: { color: "var(--muted)", fontSize: 13 } }, "Count-in (1 bar)"),
          React.createElement(Switch, { on: p.countInOn, onClick: function () { p.setCountInOn(!p.countInOn); } })
        ),
        React.createElement("div", { className: "toggle-row" },
          React.createElement("span", { style: { color: "var(--muted)", fontSize: 13 } }, "Metronome click"),
          React.createElement(Switch, { on: p.metro, onClick: function () { p.setMetro(!p.metro); } })
        )
      ),
      React.createElement("div", { className: "side-sec" },
        React.createElement("h3", null, "A–B loop"),
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 10 } },
          React.createElement("button", { className: "btn", style: { flex: 1, justifyContent: "center" }, onClick: p.setLoopA }, "Set A"),
          React.createElement("button", { className: "btn", style: { flex: 1, justifyContent: "center" }, onClick: p.setLoopB }, "Set B")
        ),
        React.createElement("div", { className: "toggle-row" },
          React.createElement("span", { style: { color: "var(--muted)", fontSize: 13 } }, "Loop enabled"),
          React.createElement(Switch, { on: p.loopOn, onClick: function () { if (p.loopA != null && p.loopB != null) p.setLoopOn(!p.loopOn); } })
        ),
        React.createElement("button", { className: "btn ghost", style: { width: "100%", justifyContent: "center" }, onClick: p.clearLoop }, "Clear loop")
      ),
      SpacingSec(p),
      legendSec()
    );
  }

  function legendSec() {
    return React.createElement("div", { className: "side-sec", key: "legend" },
      React.createElement("h3", null, "Legend"),
      React.createElement("div", { className: "legend" },
        React.createElement("div", { className: "lrow" }, React.createElement("span", { className: "sw", style: { background: LANE_COLORS[0] } }), "Snare (red)"),
        React.createElement("div", { className: "lrow" }, React.createElement("span", { className: "sw", style: { background: LANE_COLORS[2] } }), "Tom — circle"),
        React.createElement("div", { className: "lrow" }, React.createElement("span", { className: "sw dia", style: { background: LANE_COLORS[2] } }), "Cymbal — diamond"),
        React.createElement("div", { className: "lrow" }, React.createElement("span", { className: "sw bar", style: { background: KICK_COLOR } }), "Kick — full-width bar")
      )
    );
  }
