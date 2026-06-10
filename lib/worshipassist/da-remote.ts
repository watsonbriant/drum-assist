// @ts-nocheck
/* WorshipAssist — Supabase remote persistence (solo user, no auth) */

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

const BUCKET = "chart-audio";

function audioPath(chartId: string, fileName: string) {
  return chartId + "/" + encodeURIComponent(fileName);
}

function rowToChart(row) {
  return {
    version: row.version,
    id: row.id,
    name: row.name,
    audioName: row.audio_name,
    audioPath: row.audio_path,
    bpm: row.bpm,
    offset: row.offset_seconds,
    beatsPerBar: row.beats_per_bar,
    tsNum: row.ts_num,
    tsDen: row.ts_den,
    duration: row.duration,
    notes: row.notes || [],
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function chartToRow(chart) {
  const path =
    chart.audioPath ||
    (chart.audioName ? audioPath(chart.id, chart.audioName) : null);
  return {
    id: chart.id,
    name: chart.name,
    version: chart.version ?? 2,
    bpm: chart.bpm,
    offset_seconds: chart.offset,
    beats_per_bar: chart.beatsPerBar ?? chart.tsNum ?? 4,
    ts_num: chart.tsNum || chart.beatsPerBar || 4,
    ts_den: chart.tsDen || 4,
    duration: chart.duration || 0,
    audio_name: chart.audioName,
    audio_path: path,
    notes: chart.notes || [],
    updated_at: new Date(chart.updatedAt || Date.now()).toISOString(),
  };
}

function guessContentType(name: string) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
  };
  return map[ext] || "application/octet-stream";
}

export const DARemote = {
  isConfigured: isSupabaseConfigured,
  audioPath,

  async listChartsFull() {
    const sb = getSupabase();
    if (!sb) return [];
    const { data, error } = await sb
      .from("charts")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToChart);
  },

  async upsertChart(chart) {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from("charts").upsert(chartToRow(chart));
    if (error) throw error;
  },

  async deleteChart(id: string) {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from("charts").delete().eq("id", id);
    if (error) throw error;
  },

  async uploadAudio(chartId: string, name: string, arrayBuffer: ArrayBuffer) {
    const sb = getSupabase();
    if (!sb) return null;
    const path = audioPath(chartId, name);
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, arrayBuffer, {
        upsert: true,
        contentType: guessContentType(name),
      });
    if (error) throw error;
    return path;
  },

  async downloadAudio(path: string) {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    const parts = path.split("/");
    const name = decodeURIComponent(parts[parts.length - 1] || "audio");
    return { name, data: await data.arrayBuffer() };
  },

  async deleteAudio(path: string) {
    const sb = getSupabase();
    if (!sb || !path) return;
    const { error } = await sb.storage.from(BUCKET).remove([path]);
    if (error) throw error;
  },

  async copyAudio(fromPath: string, toChartId: string, toName: string) {
    const sb = getSupabase();
    if (!sb || !fromPath) return null;
    const rec = await DARemote.downloadAudio(fromPath);
    if (!rec) return null;
    return DARemote.uploadAudio(toChartId, toName, rec.data);
  },
};
