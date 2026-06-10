const CHROMATIC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const ENHARMONIC: Record<string, string> = {
  Db: "C#", Eb: "D#", Fb: "E", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B",
  "E#": "F", "B#": "C",
};

const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

const MOD_TOKEN =
  "(?:maj7|m7|sus4|sus2|add\\d+|pwr|m|7|dim|aug)";

const NNS_PATTERN = new RegExp(
  "^([b#]?)(\\d)(" + MOD_TOKEN + "*)?(\\/([b#]?)(\\d))?$"
);

export const SONG_KEY_OPTIONS = [
  { value: "C", label: "C" },
  { value: "C#", label: "C# / Db" },
  { value: "D", label: "D" },
  { value: "D#", label: "D# / Eb" },
  { value: "E", label: "E" },
  { value: "F", label: "F" },
  { value: "F#", label: "F# / Gb" },
  { value: "G", label: "G" },
  { value: "G#", label: "G# / Ab" },
  { value: "A", label: "A" },
  { value: "A#", label: "A# / Bb" },
  { value: "B", label: "B" },
];

export type NashvilleParts = {
  prefix: string;
  degree: number;
  mod: string;
  bassPrefix: string;
  bassDegree: number | null;
};

function chromaticIndex(root: string): number {
  const n = normalizeRoot(root);
  const i = CHROMATIC.indexOf(n);
  return i >= 0 ? i : 0;
}

function noteAtIndex(i: number): string {
  return CHROMATIC[((i % 12) + 12) % 12];
}

export function normalizeRoot(note: string): string {
  if (!note) return "C";
  const trimmed = note.trim();
  const match = trimmed.match(/^([A-Ga-g])([#b]?)/);
  if (!match) return trimmed;
  const letter = match[1].toUpperCase();
  const acc = match[2] || "";
  const named = letter + acc;
  return ENHARMONIC[named] || named;
}

export function parseChord(chord: string): { root: string; modifier: string } | null {
  if (!chord || !chord.trim()) return null;
  const s = chord.trim();
  const m = s.match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!m) return null;
  return { root: normalizeRoot(m[1]), modifier: m[2] || "" };
}

function normalizeModifier(mod: string): string {
  let m = mod || "";
  m = m.replace(/min/g, "m");
  m = m.replace(/maj7/g, "maj7");
  m = m.replace(/△7/g, "maj7");
  m = m.replace(/△/g, "maj");
  m = m.replace(/major/g, "maj");
  m = m.replace(/minor/g, "m");
  return m;
}

function modifierToChordName(mod: string): string {
  if (mod === "pwr") return "5";
  return normalizeModifier(mod);
}

function chordNameToModifier(mod: string): string {
  const m = normalizeModifier(mod);
  if (m === "5") return "pwr";
  return m;
}

function scaleIntervals(isMinorKey?: boolean) {
  return isMinorKey ? MINOR_SCALE_INTERVALS : MAJOR_SCALE_INTERVALS;
}

function degreeRoot(key: string, degree: number, prefix: string, isMinorKey?: boolean): string {
  const keyIdx = chromaticIndex(key);
  const intervals = scaleIntervals(isMinorKey);
  const deg = Math.max(1, Math.min(7, degree));
  let semi = intervals[deg - 1];
  if (prefix === "b") semi -= 1;
  if (prefix === "#") semi += 1;
  return noteAtIndex(keyIdx + semi);
}

function findDegree(root: string, key: string, isMinorKey?: boolean): { prefix: string; degree: number } | null {
  const keyIdx = chromaticIndex(key);
  const intervals = scaleIntervals(isMinorKey);
  for (let d = 1; d <= 7; d++) {
    if (noteAtIndex(keyIdx + intervals[d - 1]) === root) {
      return { prefix: "", degree: d };
    }
  }
  for (let d = 1; d <= 7; d++) {
    if (noteAtIndex(keyIdx + intervals[d - 1] - 1) === root) {
      return { prefix: "b", degree: d };
    }
  }
  for (let d = 1; d <= 7; d++) {
    if (noteAtIndex(keyIdx + intervals[d - 1] + 1) === root) {
      return { prefix: "#", degree: d };
    }
  }
  return null;
}

export function parseNashville(input: string): NashvilleParts | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(NNS_PATTERN);
  if (!m) return null;
  const degree = parseInt(m[2], 10);
  if (degree < 1 || degree > 7) return null;
  let bassDegree: number | null = null;
  if (m[4] != null) {
    bassDegree = parseInt(m[6], 10);
    if (bassDegree < 1 || bassDegree > 7) return null;
  }
  return {
    prefix: m[1] || "",
    degree: degree,
    mod: m[3] || "",
    bassPrefix: m[4] != null ? (m[5] || "") : "",
    bassDegree: bassDegree,
  };
}

export function buildNashville(parts: NashvilleParts): string {
  let s = (parts.prefix || "") + String(parts.degree) + (parts.mod || "");
  if (parts.bassDegree != null) {
    s += "/" + (parts.bassPrefix || "") + String(parts.bassDegree);
  }
  return s;
}

export function validateNashvilleInput(input: string): boolean {
  return parseNashville(input) !== null;
}

export function chordToNashville(chord: string, key: string, isMinorKey?: boolean): string {
  if (!chord || !chord.trim()) return "";
  const s = chord.trim();
  const slashIdx = s.indexOf("/");
  let main = s;
  let bassPart: string | null = null;
  if (slashIdx >= 0) {
    main = s.slice(0, slashIdx);
    bassPart = s.slice(slashIdx + 1);
  }
  const parsed = parseChord(main);
  if (!parsed) return "";
  const mod = chordNameToModifier(parsed.modifier);
  const found = findDegree(parsed.root, key, isMinorKey);
  if (!found) return parsed.root + mod;
  let result = found.prefix + found.degree + mod;
  if (bassPart) {
    const bassRoot = normalizeRoot(bassPart);
    const bassFound = findDegree(bassRoot, key, isMinorKey);
    if (bassFound) result += "/" + bassFound.prefix + bassFound.degree;
    else result += "/" + bassRoot;
  }
  return result;
}

export function nashvilleToChord(nashville: string, key: string, isMinorKey?: boolean): string {
  const p = parseNashville(nashville);
  if (!p) return (nashville || "").trim();
  const root = degreeRoot(key, p.degree, p.prefix, isMinorKey);
  let chord = root + modifierToChordName(p.mod);
  if (p.bassDegree != null) {
    const bass = degreeRoot(key, p.bassDegree, p.bassPrefix, isMinorKey);
    chord += "/" + bass;
  }
  return chord;
}

export function formatChordDisplay(
  nashville: string,
  key: string,
  showChordNames: boolean,
  isMinorKey?: boolean
): string {
  if (!nashville) return "";
  if (!showChordNames) return nashville;
  return nashvilleToChord(nashville, key, isMinorKey) || nashville;
}
