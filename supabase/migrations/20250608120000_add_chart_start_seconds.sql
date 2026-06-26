-- Chart playback/highway start time (seconds into the audio file).
alter table charts
  add column if not exists chart_start_seconds double precision not null default 0;

comment on column charts.chart_start_seconds is
  'Seconds into the audio where the chart/highway begins (playback, count-in, rewind).';
