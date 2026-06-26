// @ts-nocheck
"use client";

/* WorshipAssist — Side panel (Editor + Player settings) */
import React from "react";
import { DAStore } from "./da-store";
import { DA_LANE_COLORS, DA_KICK_COLOR } from "./da-highway";
import {
  SONG_KEY_OPTIONS, validateNashvilleInput, formatChordDisplay,
  parseNashville, buildNashville
} from "@/lib/nns";

const LANE_COLORS = DA_LANE_COLORS;
const KICK_COLOR = DA_KICK_COLOR;
  const SNAP_OPTS = [
    { div: 1, label: "1/4" }, { div: 2, label: "1/8" },
    { div: 4, label: "1/16" }, { div: 8, label: "1/32" },
    { div: 3, label: "trip" }
  ];

  const DEGREE_OPTS = [1, 2, 3, 4, 5, 6, 7];
  const PREFIX_OPTS = ["", "b", "#"];
  const MOD_OPTS = ["", "m", "7", "m7", "maj7", "sus4", "sus2", "dim", "aug", "pwr"];
  const MOD_LABELS = {
    "": "major", m: "m", 7: "7", m7: "m7", maj7: "maj7",
    sus4: "sus4", sus2: "sus2", dim: "dim", aug: "aug", pwr: "power"
  };

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

  function Seg(p) {
    return React.createElement("div", { className: "seg side-seg" },
      p.options.map(function (o) {
        return React.createElement("button", {
          key: o.id, className: p.value === o.id ? "on" : "",
          onClick: function () { p.onChange(o.id); }
        }, o.label);
      })
    );
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

  function KeyField(p) {
    return React.createElement("div", { className: "field" },
      React.createElement("label", null, "Key"),
      React.createElement("select", {
        className: "keysel", value: p.chart.songKey || "C",
        onChange: function (e) { p.patchChart({ songKey: e.target.value }); }
      }, SONG_KEY_OPTIONS.map(function (k) {
        return React.createElement("option", { key: k.value, value: k.value }, k.label);
      }))
    );
  }

  function ChartTypeSec(p) {
    return React.createElement("div", { className: "side-sec" },
      React.createElement("h3", null, "Chart"),
      Seg({
        value: p.chartType,
        onChange: p.setChartType,
        options: [{ id: "drum", label: "Drum" }, { id: "chord", label: "Chord" }]
      }),
      React.createElement("div", { className: "toggle-row", style: { marginTop: 12 } },
        React.createElement("span", { style: { color: "var(--muted)", fontSize: 13 } }, "Show as"),
        Seg({
          value: p.showChordNames ? "chord" : "number",
          onChange: function (v) { p.setShowChordNames(v === "chord"); },
          options: [{ id: "number", label: "Numbers" }, { id: "chord", label: "Chords" }]
        })
      )
    );
  }

  function defaultNashvilleParts() {
    return { prefix: "", degree: 1, mod: "", bassPrefix: "", bassDegree: null };
  }

  function NashvillePicker(p) {
    if (!p.chordEdit) return null;
    const parts = parseNashville(p.chordEdit.nashville) || defaultNashvilleParts();
    const preview = formatChordDisplay(
      p.chordEdit.nashville, p.chart.songKey || "C", true
    );
    const valid = validateNashvilleInput(p.chordEdit.nashville);

    function setParts(patch) {
      const next = Object.assign({}, parts, patch);
      if (patch.bassDegree === null) next.bassPrefix = "";
      const nashville = buildNashville(next);
      p.setChordEdit(Object.assign({}, p.chordEdit, { nashville: nashville }));
    }

    return React.createElement("div", { className: "side-sec nns-picker" },
      React.createElement("h3", null, p.chordEdit.isNew ? "New chord" : "Edit chord"),
      React.createElement("div", { className: "nns-preview" + (valid ? "" : " invalid") },
        React.createElement("span", { className: "nns-num" }, p.chordEdit.nashville || "—"),
        React.createElement("span", { className: "nns-eq" }, "="),
        React.createElement("span", { className: "nns-chord" }, preview || "—")
      ),
      React.createElement("div", { className: "chips", style: { marginBottom: 8 } },
        PREFIX_OPTS.map(function (pre) {
          return React.createElement("div", {
            key: "p" + (pre || "n"), className: "chip" + (parts.prefix === pre ? " on" : ""),
            onClick: function () { setParts({ prefix: pre }); }
          }, pre || "natural");
        })
      ),
      React.createElement("div", { className: "chips", style: { marginBottom: 8 } },
        DEGREE_OPTS.map(function (d) {
          return React.createElement("div", {
            key: "d" + d, className: "chip" + (parts.degree === d ? " on" : ""),
            onClick: function () { setParts({ degree: d }); }
          }, String(d));
        })
      ),
      React.createElement("div", { className: "chips", style: { marginBottom: 8 } },
        MOD_OPTS.map(function (mod) {
          return React.createElement("div", {
            key: "m" + (mod || "0"), className: "chip" + (parts.mod === mod ? " on" : ""),
            onClick: function () { setParts({ mod: mod }); }
          }, MOD_LABELS[mod] || mod);
        })
      ),
      React.createElement("div", { className: "nns-subhead" }, "Over (bass)"),
      React.createElement("div", { className: "hint", style: { marginBottom: 8 } }, "e.g. 1 over 3 → ", React.createElement("b", null, "1/3")),
      parts.bassDegree != null ? React.createElement("div", { className: "chips", style: { marginBottom: 8 } },
        PREFIX_OPTS.map(function (pre) {
          return React.createElement("div", {
            key: "bp" + (pre || "n"), className: "chip" + (parts.bassPrefix === pre ? " on" : ""),
            onClick: function () { setParts({ bassPrefix: pre }); }
          }, pre || "natural");
        })
      ) : null,
      React.createElement("div", { className: "chips" },
        React.createElement("div", {
          className: "chip" + (parts.bassDegree == null ? " on" : ""),
          onClick: function () { setParts({ bassDegree: null, bassPrefix: "" }); }
        }, "none"),
        DEGREE_OPTS.map(function (d) {
          return React.createElement("div", {
            key: "b" + d, className: "chip" + (parts.bassDegree === d ? " on" : ""),
            onClick: function () { setParts({ bassDegree: d }); }
          }, String(d));
        })
      ),
      React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 12 } },
        React.createElement("button", {
          className: "btn primary", style: { flex: 1, justifyContent: "center" },
          disabled: !valid, onClick: p.saveChordEdit
        }, "Save"),
        React.createElement("button", {
          className: "btn", style: { flex: 1, justifyContent: "center" },
          onClick: p.cancelChordEdit
        }, "Cancel")
      ),
      !p.chordEdit.isNew ? React.createElement("button", {
        className: "btn", style: { width: "100%", justifyContent: "center", marginTop: 8, color: "var(--red)" },
        onClick: p.deleteChordEdit
      }, "Delete chord") : null
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

  function SnapSec(p) {
    return React.createElement("div", { className: "side-sec" },
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
    );
  }

  function PlaybackSec(p) {
    return React.createElement(React.Fragment, null,
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
      )
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

  function SongSec(p) {
    return React.createElement("div", { className: "side-sec" },
      React.createElement("h3", null, "Song"),
      React.createElement("button", { className: "btn", style: { width: "100%", justifyContent: "center", marginBottom: 12 }, onClick: p.openFile },
        p.hasAudio ? "Replace audio…" : "Load audio…"),
      React.createElement(NumField, { label: "BPM", value: p.chart.bpm, step: 1, onChange: function (v) { if (v > 0) p.patchChart({ bpm: Math.round(v) }); }, onStep: function (d) { p.patchChart({ bpm: Math.max(20, p.chart.bpm + d) }); } }),
      KeyField(p),
      React.createElement(NumField, { label: "First beat (s)", value: +p.chart.offset.toFixed(3), step: 0.01, onChange: function (v) { p.patchChart({ offset: Math.max(0, v || 0) }); }, onStep: function (d) { p.patchChart({ offset: Math.max(0, +(p.chart.offset + d).toFixed(3)) }); } }),
      React.createElement(NumField, {
        label: "Chart start (s)", value: +(p.chart.chartStart || 0).toFixed(3), step: 0.01,
        onChange: function (v) { p.patchChart({ chartStart: Math.max(0, v || 0) }); },
        onStep: function (d) { p.patchChart({ chartStart: Math.max(0, +((p.chart.chartStart || 0) + d).toFixed(3)) }); }
      }),
      React.createElement(TimeSigField, { chart: p.chart, patchChart: p.patchChart }),
      p.mode === "edit" ? React.createElement("div", { className: "hint", style: { marginTop: 4 } },
        "Tip: drag the yellow marker on the waveform for the first downbeat. Drag the cyan marker at the bottom for chart start — playback and count-in begin there."
      ) : null
    );
  }

  export function SidePanel(p: Record<string, unknown>) {
    const isChord = p.chartType === "chord";
    if (p.mode === "edit") {
      return React.createElement("div", { className: "side" },
        ChartTypeSec(p),
        SongSec(p),
        isChord ? null : React.createElement("div", { className: "side-sec" },
          React.createElement("h3", null, "Note tool"),
          React.createElement("div", { className: "tools" },
            React.createElement(ToolBtn, { on: p.tool === "tom", onClick: function () { p.setTool("tom"); }, glyph: glyphCircle(LANE_COLORS[2]), name: "Tom", hint: "circle" }),
            React.createElement(ToolBtn, { on: p.tool === "cymbal", onClick: function () { p.setTool("cymbal"); }, glyph: glyphDiamond(LANE_COLORS[2]), name: "Cymbal", hint: "diamond" }),
            React.createElement(ToolBtn, { on: p.tool === "kick", onClick: function () { p.setTool("kick"); }, glyph: glyphBar(KICK_COLOR), name: "Kick", hint: "all lanes" })
          ),
          React.createElement("div", { className: "hint", style: { marginTop: 10 } }, "Click the ", React.createElement("b", { style: { color: LANE_COLORS[0] } }, "red"), " lane for snare. Yellow/blue/green place the selected tool. Click a note to delete it.")
        ),
        SnapSec(p),
        SpacingSec(p),
        isChord ? React.createElement("div", { className: "side-sec" },
          React.createElement("h3", null, "Chords"),
          React.createElement("div", { className: "hint" }, "Click the highway to place a chord bar, then pick a Nashville number.")
        ) : KeyEntrySec(p),
        isChord ? NashvillePicker(p) : legendSec(),
        React.createElement("div", { className: "side-sec" },
          React.createElement("button", {
            className: "btn", style: { width: "100%", justifyContent: "center" },
            onClick: isChord ? p.clearChordNotes : p.clearNotes
          }, isChord ? "Clear all chords" : "Clear all notes")
        )
      );
    }
    return React.createElement("div", { className: "side" },
      ChartTypeSec(p),
      PlaybackSec(p),
      SpacingSec(p),
      p.chartType === "drum" ? legendSec() : null
    );
  }
