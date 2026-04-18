export const MAJOR_KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B", "Cb", "C#"] as const;
export const MINOR_KEYS = ["Cm", "C#m", "Dm", "D#m", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Abm", "Am", "Bbm", "Bm"] as const;
export const KEYS = [...MAJOR_KEYS, ...MINOR_KEYS] as const;
export type KeyName = typeof KEYS[number];

export type VoicingStyle = "Default" | "Closed" | "Drop 2" | "Spread";
export type NotationMode = "alphabet" | "degree";

export interface ParsedChord {
  root: string;
  rootPc: number;
  quality: string;
  tensions: string[];
  parenContents: string[];
  bassNoteStr: string | null;
  bassNote: string | null;
  bassDegree: string | null;
  bassInterval: number | null;
  omissions: number[];
  isRoman: boolean;
  romanSymbol: string | null;
  seventh: string | null;
  alterations: string[];
}

export const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
export const TENSIONS_LIST = ["b9", "add9", "#9", "11", "#11", "b13", "13"] as const;
export const QUALITY_SYMBOLS = [
  "Major",
  "Minor",
  "6",
  "m6",
  "7",
  "9",
  "M7",
  "M9",
  "m7",
  "m9",
  "mM9",
  "7b5",
  "M7b5",
  "m7b5",
  "dim",
  "dim7",
  "aug",
  "blk",
  "sus2",
  "sus4",
  "omit3",
  "omit5",
] as const;
export const VOICING_STYLES: VoicingStyle[] = ["Default", "Closed", "Drop 2", "Spread"];

const BASE_OCTAVE = 48;
const MAJOR_DEGREE_TO_SEMITONES: Record<string, number> = {
  I: 0,
  II: 2,
  III: 4,
  IV: 5,
  V: 7,
  VI: 9,
  VII: 11,
};
const MINOR_DEGREE_TO_SEMITONES: Record<string, number> = {
  I: 0,
  II: 2,
  III: 3,
  IV: 5,
  V: 7,
  VI: 8,
  VII: 10,
};
const KEY_PREFERS_SHARPS: Record<KeyName, boolean> = {
  C: true, G: true, D: true, A: true, E: true, B: true, "F#": true, "C#": true,
  F: false, Bb: false, Eb: false, Ab: false, Db: false, Gb: false, Cb: false,
  Am: true, Em: true, Bm: true, "F#m": true, "C#m": true, "G#m": true, "D#m": true,
  Dm: false, Gm: false, Cm: false, Fm: false, Bbm: false, Ebm: false, Abm: false,
};
const KEY_SPECIFIC_NAMES: Partial<Record<KeyName, Record<number, string>>> = {
  "F#": { 5: "E#" },
  "C#": { 5: "E#", 0: "B#" },
  Gb: { 11: "Cb" },
  Db: { 11: "Cb" },
  Cb: { 4: "Fb", 9: "Bbb" },
  "D#m": { 5: "E#" },
  Ebm: { 11: "Cb" },
  Abm: { 4: "Fb" },
};
const ROMAN_PATTERN = "(?:VII|VI|V|IV|III|II|I)";
const ROMAN_RE = new RegExp(`^([b#]?)(${ROMAN_PATTERN})$`, "i");
const TENSION_MAP: Record<string, number> = {
  "6": 9,
  b6: 8,
  "9": 14,
  b9: 13,
  "#9": 15,
  "11": 17,
  "#11": 18,
  "13": 21,
  b13: 20,
};

export function prefersSharps(key: string): boolean {
  return KEY_PREFERS_SHARPS[key as KeyName] ?? true;
}

export function romanDegreesForKey(key: string): string[] {
  const isMinorKey = key.endsWith("m");
  const minorMap: Record<number, string> = {
    0: "I", 1: "bII", 2: "II", 3: "III", 4: "#III", 5: "IV", 6: "bV", 7: "V", 8: "VI", 9: "#VI", 10: "VII", 11: "#VII"
  };
  const majorMap: Record<number, string> = {
    0: "I", 1: "bII", 2: "II", 3: "bIII", 4: "III", 5: "IV", 6: "bV", 7: "V", 8: "bVI", 9: "VI", 10: "bVII", 11: "VII"
  };
  const map = isMinorKey ? minorMap : majorMap;
  return Array.from({ length: 12 }, (_, semitone) => map[semitone]);
}

export function getNoteNamesForKey(key: string): string[] {
  return Array.from({ length: 12 }, (_, index) => pcToName(index, prefersSharps(key), key));
}

export function nameToPc(name: string): number {
  const table: Record<string, number> = {
    C: 0,
    "B#": 0,
    Dbb: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "C##": 2,
    Ebb: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    Fb: 4,
    "D##": 4,
    F: 5,
    "E#": 5,
    Gbb: 5,
    "F#": 6,
    Gb: 6,
    "E##": 6,
    G: 7,
    "F##": 7,
    Abb: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "G##": 9,
    Bbb: 9,
    "A#": 10,
    Bb: 10,
    Cbb: 10,
    B: 11,
    Cb: 11,
    "A##": 11,
  };

  const trimmed = name.trim();
  const normalized =
    trimmed.length > 1 && ["b", "#"].includes(trimmed[1])
      ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`
      : `${trimmed[0].toUpperCase()}${trimmed.slice(1).toLowerCase()}`;

  if (!(normalized in table)) {
    throw new Error(`Unknown note name: ${normalized}`);
  }

  return table[normalized];
}

export function pcToName(pc: number, useSharps: boolean, key?: string): string {
  const normalizedPc = ((pc % 12) + 12) % 12;

  if (key && KEY_SPECIFIC_NAMES[key as KeyName]?.[normalizedPc]) {
    return KEY_SPECIFIC_NAMES[key as KeyName]![normalizedPc];
  }

  return useSharps ? NOTE_NAMES_SHARP[normalizedPc] : NOTE_NAMES_FLAT[normalizedPc];
}

export function midiToDisplayName(midi: number, key?: string): string {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${pcToName(pitchClass, prefersSharps(key ?? "C"), key)}${octave}`;
}

export function parseTensions(text: string): string[] {
  if (!text) {
    return [];
  }

  let inner = text.trim();
  if (inner.startsWith("(") && inner.endsWith(")")) {
    inner = inner.slice(1, -1);
  }
  if (!inner) {
    return [];
  }

  const parts = inner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalized = parts
    .map((part) => part.replaceAll("+", "#").replaceAll("-", "b"))
    .filter((part) => /^(?:b|#)?(?:6|9|11|13|5)$/.test(part));

  const seen = new Set<string>();
  const output: string[] = [];

  for (const tension of normalized) {
    const coreNumber = tension.replaceAll(/\D/g, "");
    if (!seen.has(coreNumber)) {
      output.push(tension);
      seen.add(coreNumber);
    }
  }

  return output;
}

export function romanToPcOffset(key: string, builderRoot: string): number {
    const romanMatch = builderRoot.match(ROMAN_RE);
    const accidental = romanMatch![1] || "";
    const romanNumeral = romanMatch![2].toUpperCase();

    const isMinorKey = key.endsWith("m");
    const degreeMap = isMinorKey ? MINOR_DEGREE_TO_SEMITONES : MAJOR_DEGREE_TO_SEMITONES;
    const baseDegreeSemitones = degreeMap[romanNumeral];
    
    let semitoneOffset = baseDegreeSemitones;
    if (accidental === "b") {
      semitoneOffset -= 1;
    } else if (accidental === "#") {
      semitoneOffset += 1;
    }

    const keyRootPc = nameToPc(key.replace("m", ""));
    return (keyRootPc + semitoneOffset + 12) % 12;
}

export function parseChordSymbol(text: string, key: string): ParsedChord {
  let symbol = (text ?? "").trim();
  if (!symbol) {
    return {
      root: "C",
      rootPc: 0,
      quality: "Major",
      tensions: [],
      parenContents: [],
      bassNoteStr: null,
      bassNote: null,
      bassDegree: null,
      bassInterval: null,
      omissions: [],
      isRoman: false,
      romanSymbol: null,
      seventh: null,
      alterations: [],
    };
  }

  const replacements: Record<string, string> = {
    "♭": "b",
    "♯": "#",
    "♮": "",
    "𝄪": "##",
    "𝄫": "bb",
    "＃": "#",
    ｂ: "b",
  };

  Object.entries(replacements).forEach(([source, target]) => {
    symbol = symbol.replaceAll(source, target);
  });

  const isBlk = /blk/i.test(symbol);
  if (isBlk) {
    symbol = symbol.replace(/blk/gi, "").trim();
  }

  let bassNoteStr: string | null = null;
  let bassNote: string | null = null;
  if (symbol.includes("/")) {
    const [main, bass] = symbol.split("/", 2);
    symbol = main.trim();
    bassNoteStr = bass.trim();

    try {
      bassNote = pcToName(nameToPc(bassNoteStr), prefersSharps(key), key);
    } catch {
      bassNoteStr = null;
      bassNote = null;
    }
  }

  const omissions: number[] = [];
  if (symbol.includes("omit3")) {
    omissions.push(3);
    symbol = symbol.replace("omit3", "").trim();
  }
  if (symbol.includes("omit5")) {
    omissions.push(5);
    symbol = symbol.replace("omit5", "").trim();
  }

  let parenContents: string[] = [];
  const tensionMatch = symbol.match(/\(.*\)/);
  if (tensionMatch) {
    const tensionText = tensionMatch[0];
    parenContents = parseTensions(tensionText);
    symbol = symbol.replace(tensionText, "").trim();
    if (!symbol && parenContents.length === 0) {
      const inner = tensionText.slice(1, -1).trim();
      if (inner) {
        symbol = inner;
      }
    }
  }

  symbol = symbol
    .replace(/maj7/gi, "M7")
    .replace(/Maj7/gi, "M7")
    .replace(/maj/gi, "M")
    .replace(/min6/g, "m6")
    .replace(/min/g, "m")
    .replace(/ø/g, "m7b5")
    .replace(/°/g, "dim");

  symbol = symbol
    .replace(/-5/g, "b5")
    .replace(/\+5/g, "#5")
    .replace(/-9/g, "b9")
    .replace(/\+9/g, "#9")
    .replace(/\+11/g, "#11")
    .replace(/-13/g, "b13");

  symbol = symbol.replace(/-/g, "m");

  let head: string;
  let rest: string;
  let isRoman = false;
  let root: string;
  let rootPc: number;

  const romanMatch = symbol.match(new RegExp(`^([b#]?${ROMAN_PATTERN})`, "i"));
  if (romanMatch) {
    head = romanMatch[1];
    rest = symbol.slice(head.length).trim();
    isRoman = true;
    root = pcToName(romanToPcOffset(key, head), prefersSharps(key), key);
    rootPc = nameToPc(root);
  } else {
    const alphaMatch = symbol.match(/^([A-G](?:##|bb|#|b)?)/i);
    if (!alphaMatch) {
      throw new Error(`Unrecognized chord symbol '${text}'`);
    }

    head = alphaMatch[1];
    rest = symbol.slice(head.length).trim();
    root = `${head[0].toUpperCase()}${head.slice(1)}`;
    rootPc = nameToPc(root);
  }

  let bassInterval: number | null = null;
  let bassDegree: string | null = null;
  if (bassNoteStr && isRoman) {
    if (ROMAN_RE.test(bassNoteStr)) {
      bassDegree = bassNoteStr;
    } else {
      try {
        const bassNotePc = nameToPc(bassNoteStr);
        bassDegree = buildStringFromParsed(
          {
            root: bassNoteStr,
            rootPc: bassNotePc,
            quality: "Major",
            tensions: [],
            parenContents: [],
            bassNoteStr: null,
            bassNote: null,
            bassDegree: null,
            bassInterval: null,
            omissions: [],
            isRoman: false,
            romanSymbol: null,
            seventh: null,
            alterations: [],
          },
          true,
          key,
        );
      } catch {
        bassNoteStr = null;
        bassNote = null;
        bassDegree = null;
      }
    }
  }

  let quality = "Major";
  let seventh: string | null = null;
  const tensions: string[] = [];
  const alterations: string[] = [];
  let mutableRest = rest;

  const majorTensionMatch = mutableRest.match(/M([b#]?(?:9|11|13))/);
  if (majorTensionMatch) {
    mutableRest = mutableRest.replace(majorTensionMatch[0], `M7${majorTensionMatch[1]}`);
  }

  const tensionRegexes = [/([b#]?13)/g, /([b#]?11)/g, /([b#]?9)/g, /([b#]?6)/g];
  tensionRegexes.forEach((regex) => {
    const matches = [...mutableRest.matchAll(regex)];
    matches.forEach((match) => {
      tensions.push(match[1]);
      mutableRest = mutableRest.replace(match[1], "");
    });
  });

  const seventhMatch = mutableRest.match(/M7|m7|7|dim7|M/);
  if (seventhMatch) {
    const seventhText = seventhMatch[0];
    seventh = seventhText === "7" ? "m7" : seventhText === "M" ? "M7" : seventhText;
    if (seventhText === "m7") {
      quality = "Minor";
    } else if (seventhText === "dim7") {
      quality = "dim";
    }
    mutableRest = mutableRest.replace(seventhText, "");
  } else if (tensions.length > 0 || parenContents.length > 0) {
    const nonSixTensions = tensions.filter((tension) => tension !== "6");
    if (nonSixTensions.length > 0 && !["M7", "m7", "dim7"].some((token) => rest.includes(token))) {
      seventh = "m7";
    }
  }

  if (isBlk) {
    quality = "blk";
  } else if (mutableRest.includes("sus4")) {
    quality = "sus4";
    mutableRest = mutableRest.replace("sus4", "");
  } else if (mutableRest.includes("sus2")) {
    quality = "sus2";
    mutableRest = mutableRest.replace("sus2", "");
  } else if (mutableRest.includes("m6")) {
    quality = "Minor";
    tensions.push("6");
    mutableRest = mutableRest.replace("m6", "");
  } else if (mutableRest.includes("aug") || mutableRest.includes("+")) {
    quality = "aug";
    mutableRest = mutableRest.replace("aug", "").replace("+", "");
  } else if (mutableRest.includes("dim")) {
    quality = "dim";
    mutableRest = mutableRest.replace("dim", "");
  } else if (mutableRest.includes("m")) {
    quality = "Minor";
    mutableRest = mutableRest.replace("m", "");
  }

  if (isRoman && head === head.toLowerCase()) {
    if (["I", "II", "III", "IV", "V", "VI"].includes(head.toUpperCase())) {
      if (quality === "Major") {
        quality = "Minor";
      }
    } else if (head.toUpperCase() === "VII") {
      if (quality === "Major") {
        quality = "dim";
      }
    }
  }

  if (mutableRest.includes("b5")) {
    alterations.push("b5");
  }
  if (mutableRest.includes("#5")) {
    alterations.push("#5");
  }

  if (rest.includes("m7b5")) {
    quality = "dim";
    seventh = "m7";
    alterations.splice(0, alterations.length);
  }

  return {
    root,
    rootPc,
    quality,
    tensions,
    parenContents,
    bassNoteStr,
    bassNote,
    bassDegree,
    bassInterval,
    omissions,
    isRoman,
    romanSymbol: head,
    seventh,
    alterations,
  };
}

export function buildStringFromParsed(parsed: ParsedChord, asRoman: boolean, key: string): string {
  let base = parsed.root;

  if (asRoman) {
    if (parsed.isRoman && parsed.romanSymbol) {
      base = parsed.romanSymbol;
    } else {
      const isMinorKey = key.endsWith("m");
      const rootPc = parsed.rootPc;
      const keyRootPc = nameToPc(key.replace("m", ""));
      const intervalFromKey = (rootPc - keyRootPc + 12) % 12;

      let romanRoot = "";
      if (isMinorKey) {
        const minorMap: Record<number, string> = {
          0: "I", 1: "bII", 2: "II", 3: "III", 4: "#III", 5: "IV", 6: "bV", 7: "V", 8: "VI", 9: "#VI", 10: "VII", 11: "#VII"
        };
        romanRoot = minorMap[intervalFromKey];
      } else {
        const majorMap: Record<number, string> = {
          0: "I", 1: "bII", 2: "II", 3: "bIII", 4: "III", 5: "IV", 6: "bV", 7: "V", 8: "bVI", 9: "VI", 10: "bVII", 11: "VII"
        };
        romanRoot = majorMap[intervalFromKey];
      }

      if (parsed.quality === "Minor" || parsed.quality === "dim" || parsed.quality === "m7b5") {
        romanRoot = romanRoot.toLowerCase();
      }
      
      base = romanRoot;
    }
  }

  let coreQuality = "";
  let susText = "";
  if (parsed.quality === "Minor") {
    coreQuality = "m";
  } else if (parsed.quality === "dim" && !(parsed.seventh === "m7" || parsed.seventh === "dim7")) {
    coreQuality = "dim";
  } else if (parsed.quality === "aug") {
    coreQuality = "aug";
  } else if (parsed.quality === "blk") {
    coreQuality = "blk";
  } else if (parsed.quality === "sus2") {
    susText = "sus2";
  } else if (parsed.quality === "sus4") {
    susText = "sus4";
  }

  const hasSix = parsed.tensions.includes("6");
  const naturalTensions = parsed.tensions.filter((t) => /^\d+$/.test(t) && t !== "6");
  const alteredTensions = parsed.tensions.filter((t) => /^[b#]\d+$/.test(t));

  const highestTension =
    naturalTensions.length > 0
      ? Math.max(...naturalTensions.map((tension) => Number.parseInt(tension, 10)))
      : 0;

  const sixPart = hasSix ? "6" : "";
  let numberPart = "";
  let seventhPrefix = "";

  if (highestTension > 7) {
    numberPart = String(highestTension);
    if (parsed.seventh === "M7") {
      seventhPrefix = "M";
    }
  } else if (parsed.seventh) {
    numberPart = "7";
    if (parsed.seventh === "M7") {
      seventhPrefix = "M";
    } else if (parsed.seventh === "dim7") {
      coreQuality = "";
      numberPart = "dim7";
    }
  }

  let alterationText = parsed.alterations.join("") + alteredTensions.join("");
  if (parsed.quality === "dim" && parsed.seventh === "m7") {
    coreQuality = "";
    seventhPrefix = "m";
    numberPart = "7b5";
    alterationText = "";
  }

  const parenText = parsed.parenContents.length > 0 ? `(${parsed.parenContents.join(",")})` : "";
  const omissionText = parsed.omissions.map((omission) => `omit${omission}`).join("");

  let bassDisplay: string | null = null;
  if (asRoman && parsed.bassDegree) {
    const bassPc = romanToPcOffset(key, parsed.bassDegree);
    bassDisplay = pcToName(bassPc, prefersSharps(key), key);
  } else if (parsed.bassNoteStr !== null) {
    bassDisplay = parsed.bassNoteStr;
  }

  const showBass = Boolean(
    bassDisplay && (parsed.bassNoteStr !== null || bassDisplay !== parsed.root),
  );
  const bassText = showBass ? `/${bassDisplay}` : "";

  return `${base}${coreQuality}${sixPart}${seventhPrefix}${numberPart}${alterationText}${susText}${omissionText}${parenText}${bassText}`;
}

export function buildVoicing(
  parsed: ParsedChord,
  options: {
    omit5OnConflict: boolean;
    omitDuplicatedBass: boolean;
    voicingStyle: VoicingStyle;
    voicingOctaveShift: number;
    lastTopNote?: number | null;
  },
): number[] {
  const { omit5OnConflict, omitDuplicatedBass, voicingStyle, voicingOctaveShift } = options;
  const rootPc = parsed.rootPc;
  let intervals: number[] = [];

  if (parsed.quality === "blk") {
    // Blackadder chord: keep the written root in the bass and stack an augmented triad above it.
    intervals.push(10, 14, 18);
  } else {
    const allTensions = [...parsed.tensions, ...parsed.parenContents];

    if (parsed.quality === "Minor") {
      intervals.push(0, 3, 7);
    } else if (parsed.quality === "dim") {
      intervals.push(0, 3, 6);
    } else if (parsed.quality === "aug") {
      intervals.push(0, 4, 8);
    } else {
      intervals.push(0, 4, 7);
    }

    if (parsed.quality === "sus2") {
      intervals = intervals.filter((interval) => ![3, 4].includes(interval)).concat(2);
    }
    if (parsed.quality === "sus4") {
      intervals = intervals.filter((interval) => ![3, 4].includes(interval)).concat(5);
    }

    if (parsed.seventh === "m7") {
      intervals.push(10);
    } else if (parsed.seventh === "M7") {
      intervals.push(11);
    } else if (parsed.seventh === "dim7") {
      intervals.push(9);
    }

    if (parsed.alterations.includes("b5")) {
      intervals = intervals.filter((interval) => ![7, 8].includes(interval)).concat(6);
    }
    if (parsed.alterations.includes("#5")) {
      intervals = intervals.filter((interval) => ![6, 7].includes(interval)).concat(8);
    }

    if (parsed.omissions.includes(3)) {
      intervals = intervals.filter((interval) => ![2, 3, 4, 5].includes(interval));
    }
    if (parsed.omissions.includes(5)) {
      intervals = intervals.filter((interval) => ![6, 7, 8].includes(interval));
    }

    if (omit5OnConflict && allTensions.some((tension) => ["#11", "b13", "b6"].includes(tension))) {
      intervals = intervals.filter((interval) => interval % 12 !== 7);
    }

    allTensions.forEach((tension) => {
      if (tension in TENSION_MAP) {
        intervals.push(TENSION_MAP[tension]);
      }
    });

    const has11or13 = allTensions.some((t) => t.includes("11") || t.includes("13"));
    const has9 = allTensions.some((t) => t.includes("9"));
    if (has11or13 && !has9 && parsed.quality !== "dim") {
      intervals.push(14);
    }
  }

  intervals = [...new Set(intervals)].sort((left, right) => left - right);
  const highestTensionSemitone = Math.max(...intervals.filter((interval) => interval > 12), 0);
  const voicingMin = 45 + voicingOctaveShift * 12;
  const voicingMax = 57 + voicingOctaveShift * 12;

  const chordRootPc = rootPc;
  const chordNotePcs = [...new Set(intervals.map((interval) => (chordRootPc + (interval % 12) + 12) % 12))].sort(
    (left, right) => left - right,
  );

  const closedNotes: number[] = [];
  if (voicingStyle === "Closed") {
    const rootInstance = Math.round((60 - chordRootPc) / 12) * 12 + chordRootPc;
    chordNotePcs.forEach((pc) => {
      closedNotes.push(rootInstance + ((pc - chordRootPc + 12) % 12));
    });
  } else {
    let tensionOffset = 0;
    if (highestTensionSemitone >= 20) {
      tensionOffset = -7;
    } else if (highestTensionSemitone >= 17) {
      tensionOffset = -4;
    }
    const targetCenter = BASE_OCTAVE + 12 + voicingOctaveShift * 12 + tensionOffset;
    const rootInstance = Math.round((targetCenter - chordRootPc) / 12) * 12 + chordRootPc;
    chordNotePcs.forEach((pc) => {
      closedNotes.push(rootInstance + ((pc - chordRootPc + 12) % 12));
    });
  }

  closedNotes.sort((left, right) => left - right);

  if (voicingStyle === "Closed" && closedNotes.length > 0) {
    const adjusted = closedNotes
      .map((note) => {
        let nextNote = note;
        while (nextNote > voicingMax) {
          nextNote -= 12;
        }
        while (nextNote < voicingMin) {
          nextNote += 12;
        }
        return nextNote + 12;
      })
      .sort((left, right) => left - right);
    closedNotes.splice(0, closedNotes.length, ...adjusted);
  }

  let finalChordNotes = [...closedNotes];
  if (voicingStyle === "Default") {
    const bassPc = parsed.bassNote ? nameToPc(parsed.bassNote) : parsed.rootPc;
    const rootNoteInVoicing = BASE_OCTAVE + voicingOctaveShift * 12 + chordRootPc;
    finalChordNotes = [];

    if (intervals.includes(0) && parsed.quality !== "blk") {
      finalChordNotes.push(rootNoteInVoicing);
    }

    const sortedIntervals = [...intervals]
      .filter((interval) => interval !== 0 || parsed.quality === "blk")
      .sort((left, right) => left - right);

    let lastNote = finalChordNotes.length > 0 ? rootNoteInVoicing : BASE_OCTAVE + voicingOctaveShift * 12 + bassPc;
    sortedIntervals.forEach((interval) => {
      const notePc = (chordRootPc + (interval % 12) + 12) % 12;
      let candidate = Math.floor(lastNote / 12) * 12 + notePc;
      if (candidate <= lastNote) {
        candidate += 12;
      }
      finalChordNotes.push(candidate);
      finalChordNotes.sort((left, right) => left - right);
      lastNote = finalChordNotes[finalChordNotes.length - 1];
    });
  } else if (voicingStyle === "Drop 2" && finalChordNotes.length >= 4) {
    const noteToDrop = finalChordNotes.splice(-2, 1)[0];
    finalChordNotes.unshift(noteToDrop - 12);
    finalChordNotes.sort((left, right) => left - right);
  } else if (voicingStyle === "Spread" && finalChordNotes.length >= 3) {
    finalChordNotes = finalChordNotes.map((note, index) => (index % 2 === 1 ? note + 12 : note));
  }

  const bassPc = parsed.bassNote ? nameToPc(parsed.bassNote) : parsed.rootPc;
  const bassMidiNote =
    bassPc >= 7
      ? BASE_OCTAVE - 24 + voicingOctaveShift * 12 + bassPc
      : BASE_OCTAVE - 12 + voicingOctaveShift * 12 + bassPc;

  if (omitDuplicatedBass && finalChordNotes.length >= 4) {
    finalChordNotes = finalChordNotes.filter((note) => note % 12 !== bassPc);
  }

  return [...new Set([bassMidiNote, ...finalChordNotes])].sort((left, right) => left - right);
}

function isStandaloneParentheticalToken(token: string): boolean {
  return token.startsWith("(") && token.endsWith(")");
}

export function splitMeasureText(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let parenDepth = 0;

  const pushToken = (rawToken: string) => {
    const token = rawToken.trim();
    if (!token) {
      return;
    }

    if (isStandaloneParentheticalToken(token)) {
      tokens.push(...splitMeasureText(token.slice(1, -1)));
      return;
    }

    tokens.push(token);
  };

  for (const character of text) {
    if (/\s/.test(character) && parenDepth === 0) {
      pushToken(current);
      current = "";
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
    } else if (character === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }

    current += character;
  }

  pushToken(current);

  return tokens;
}

export function durationTicksForN(count: number, ticksPerBeat: number): number[] {
  if (count === 3) {
    return [2 * ticksPerBeat, ticksPerBeat, ticksPerBeat];
  }

  const baseDuration = Math.floor((4 * ticksPerBeat) / count);
  const remainder = (4 * ticksPerBeat) % count;
  return Array.from({ length: count }, (_, index) => baseDuration + (index < remainder ? 1 : 0));
}

export function convertMeasureText(text: string, key: string, nextMode: NotationMode): string {
  const isToDegree = nextMode === "degree";
  return splitMeasureText(text)
    .map((part) => {
      if (part === "%") {
        return part;
      }

      try {
        const parsed = parseChordSymbol(part, key);
        return buildStringFromParsed(parsed, isToDegree, key);
      } catch {
        return part;
      }
    })
    .join(" ");
}
