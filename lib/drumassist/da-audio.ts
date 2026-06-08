// @ts-nocheck
/* DrumAssist — Audio engine
 * Drives everything off the Web Audio clock so the highway never drifts.
 */

let ctx: AudioContext | null = null;
  let buffer = null;          // decoded AudioBuffer
  let source = null;          // current AudioBufferSourceNode
  let gainNode = null;
  let clickGain = null;

  // playback bookkeeping
  let playing = false;
  let startCtxTime = 0;       // ctx.currentTime when playback (the song body) began
  let startSongPos = 0;       // song position the body started at (seconds)
  let rate = 1;               // playback rate
  let pausedAt = 0;           // song position when stopped/paused
  let onEndedCb = null;
  let endTimer = null;

  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = ctx.createGain();
      gainNode.gain.value = 1;
      gainNode.connect(ctx.destination);
      clickGain = ctx.createGain();
      clickGain.gain.value = 0.9;
      clickGain.connect(ctx.destination);
    }
    return ctx;
  }

  async function resume() {
    ac();
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch (e) {}
    }
  }

  async function decodeArrayBuffer(arrayBuffer) {
    ac();
    // copy because decodeAudioData detaches the buffer
    const ab = arrayBuffer.slice(0);
    return await new Promise((resolve, reject) => {
      ctx.decodeAudioData(ab, resolve, reject);
    });
  }

  async function loadFile(file) {
    const ab = await file.arrayBuffer();
    buffer = await decodeArrayBuffer(ab);
    pausedAt = 0;
    return { duration: buffer.duration, arrayBuffer: ab };
  }

  async function loadArrayBuffer(ab) {
    buffer = await decodeArrayBuffer(ab);
    pausedAt = 0;
    return { duration: buffer.duration };
  }

  function hasAudio() { return !!buffer; }
  function duration() { return buffer ? buffer.duration : 0; }

  // ---- Waveform peaks (min/max per bucket) ----
  function computePeaks(buckets) {
    if (!buffer) return null;
    buckets = buckets || 1200;
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    const len = ch0.length;
    const block = Math.max(1, Math.floor(len / buckets));
    const peaks = new Float32Array(buckets);
    for (let b = 0; b < buckets; b++) {
      const start = b * block;
      let max = 0;
      for (let i = 0; i < block; i++) {
        const idx = start + i;
        if (idx >= len) break;
        let v = Math.abs(ch0[idx]);
        if (ch1) { const v1 = Math.abs(ch1[idx]); if (v1 > v) v = v1; }
        if (v > max) max = v;
      }
      peaks[b] = max;
    }
    return peaks;
  }

  // ---- Position math ----
  // songPos = startSongPos + (ctx.now - startCtxTime) * rate
  function getPosition() {
    if (!playing) return pausedAt;
    const p = startSongPos + (ctx.currentTime - startCtxTime) * rate;
    return p;
  }

  function ctxTimeForSong(songPos) {
    // invert the mapping; valid while playing
    return startCtxTime + (songPos - startSongPos) / rate;
  }

  function ctxNow() { return ctx ? ctx.currentTime : 0; }
  function isPlaying() { return playing; }
  function getRate() { return rate; }

  function setRate(r) {
    r = Math.max(0.25, Math.min(2, r));
    if (playing && source) {
      // re-anchor so position stays continuous
      const pos = getPosition();
      startSongPos = pos;
      startCtxTime = ctx.currentTime;
      rate = r;
      source.playbackRate.value = r;
      scheduleEndTimer();
    } else {
      rate = r;
    }
  }

  function setVolume(v) {
    if (gainNode) gainNode.gain.value = v;
  }

  function clearSource() {
    if (source) {
      try { source.onended = null; source.stop(); } catch (e) {}
      try { source.disconnect(); } catch (e) {}
      source = null;
    }
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  }

  function scheduleEndTimer() {
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
    const remaining = (duration() - getPosition()) / rate;
    if (remaining > 0 && isFinite(remaining)) {
      endTimer = setTimeout(function () {
        // natural end
        if (playing) {
          playing = false;
          pausedAt = duration();
          clearSource();
          if (onEndedCb) onEndedCb();
        }
      }, remaining * 1000 + 60);
    }
  }

  // Start the song body at song position `from` (ctx-scheduled at whenCtx, default now)
  function startBody(from, whenCtx) {
    ac();
    clearSource();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(gainNode);
    const when = whenCtx != null ? whenCtx : ctx.currentTime;
    const offset = Math.max(0, Math.min(from, duration() - 0.001));
    source.start(when, offset);
    startCtxTime = when;
    startSongPos = offset;
    playing = true;
    scheduleEndTimer();
  }

  // Simple immediate play from a position
  async function play(from) {
    await resume();
    if (!buffer) return;
    if (from == null) from = pausedAt || 0;
    startBody(from, ctx.currentTime + 0.03);
  }

  function stop() {
    if (!buffer) return;
    if (playing) pausedAt = getPosition();
    playing = false;
    clearSource();
  }

  function seek(pos) {
    pos = Math.max(0, Math.min(pos, duration()));
    if (playing) {
      startBody(pos, ctx.currentTime + 0.02);
    } else {
      pausedAt = pos;
    }
  }

  // ---- Click / metronome ----
  function scheduleClick(whenCtx, accent) {
    ac();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1760 : 1100;
    const t = Math.max(whenCtx, ctx.currentTime);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(g);
    g.connect(clickGain);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  // Count-in: schedule `beats` clicks at the practice tempo, then start the
  // song body so beat (beats+1) lands exactly when the song's `from` begins.
  // Returns the ctx time at which the song body starts.
  async function countInAndPlay(beats, secPerBeat, from) {
    await resume();
    if (!buffer) return 0;
    clearSource();
    const interval = secPerBeat / rate; // real-time interval honoring practice rate
    const t0 = ctx.currentTime + 0.12;
    for (let i = 0; i < beats; i++) {
      scheduleClick(t0 + i * interval, i % 4 === 0);
    }
    const bodyStart = t0 + beats * interval;
    startBody(from, bodyStart);
    return bodyStart;
  }

  function setClickVolume(v) {
    if (clickGain) clickGain.gain.value = v;
  }

export const DAAudio = {
  resume, loadFile, loadArrayBuffer, decodeArrayBuffer,
  hasAudio, duration, computePeaks,
  getPosition, ctxTimeForSong, ctxNow, isPlaying, getRate,
  setRate, setVolume, setClickVolume,
  play, stop, seek,
  scheduleClick, countInAndPlay,
  setOnEnded: function (cb: (() => void) | null) { onEndedCb = cb; },
  get ctx() { return ctx; }
};
