import { getNoteNamesForKey, romanDegreesForKey, type KeyName, type NotationMode } from "./chord";

const COMMON_ALPHA_ROOTS = [
  "C",
  "C#",
  "Db",
  "D",
  "D#",
  "Eb",
  "E",
  "Fb",
  "E#",
  "F",
  "F#",
  "Gb",
  "G",
  "G#",
  "Ab",
  "A",
  "A#",
  "Bb",
  "B",
  "Cb",
  "B#",
] as const;

const BASE_CHORD_OPTIONS = [
  { suffix: "", detail: "Major" },
  { suffix: "m", detail: "Minor" },
  { suffix: "6", detail: "6" },
  { suffix: "m6", detail: "m6" },
  { suffix: "7", detail: "7" },
  { suffix: "M7", detail: "M7" },
  { suffix: "m7", detail: "m7" },
  { suffix: "mM7", detail: "mM7" },
  { suffix: "7b5", detail: "7b5" },
  { suffix: "M7b5", detail: "M7b5" },
  { suffix: "m7b5", detail: "m7b5" },
  { suffix: "dim", detail: "dim" },
  { suffix: "dim7", detail: "dim7" },
  { suffix: "aug", detail: "aug" },
  { suffix: "blk", detail: "blk" },
  { suffix: "sus2", detail: "sus2" },
  { suffix: "sus4", detail: "sus4" },
  { suffix: "omit3", detail: "omit3" },
  { suffix: "omit5", detail: "omit5" },
] as const;

const TENSION_OPTIONS = ["9", "b9", "#9", "11", "#11", "13", "b13"] as const;

export interface ChordAutocompleteSuggestion {
  value: string;
  label: string;
  detail: string;
}

export interface ChordAutocompleteMatch {
  kind: "root" | "quality" | "tension";
  token: string;
  tokenStart: number;
  tokenEnd: number;
  suggestions: ChordAutocompleteSuggestion[];
}

function uniqueCaseInsensitive(values: readonly string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function getRootOptions(mode: NotationMode, key: KeyName): string[] {
  if (mode === "degree") {
    return romanDegreesForKey(key);
  }

  return uniqueCaseInsensitive([...getNoteNamesForKey(key), ...COMMON_ALPHA_ROOTS]);
}

function stripTensionNumber(value: string): string {
  return value.replaceAll(/\D/g, "");
}

function getTokenBounds(value: string, caret: number) {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const left = value.slice(0, safeCaret);
  const right = value.slice(safeCaret);
  const tokenStart = left.match(/\S+$/)?.index ?? safeCaret;
  const tokenEnd = safeCaret + (right.match(/^\S*/)?.[0].length ?? 0);

  return {
    tokenStart,
    tokenEnd,
    token: value.slice(tokenStart, tokenEnd),
    caretOffset: safeCaret - tokenStart,
  };
}

function buildTensionSuggestions(token: string, caretOffset: number): ChordAutocompleteSuggestion[] | null {
  const openIndex = token.lastIndexOf("(");
  if (openIndex < 0 || caretOffset <= openIndex) {
    return null;
  }

  const closeIndex = token.indexOf(")", openIndex + 1);
  if (closeIndex >= 0 && caretOffset > closeIndex) {
    return null;
  }

  const inner = closeIndex >= 0 ? token.slice(openIndex + 1, closeIndex) : token.slice(openIndex + 1);
  const innerCaret = Math.min(Math.max(0, caretOffset - openIndex - 1), inner.length);
  const segments = inner.split(",");

  let currentSegmentIndex = 0;
  let offset = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segmentLength = segments[index].length;
    if (innerCaret <= offset + segmentLength) {
      currentSegmentIndex = index;
      break;
    }
    offset += segmentLength + 1;
    currentSegmentIndex = index + 1;
  }

  const segmentStart = segments.slice(0, currentSegmentIndex).join(",").length + (currentSegmentIndex > 0 ? 1 : 0);
  const currentSegment = segments[currentSegmentIndex] ?? "";
  const query = currentSegment.trim();
  const queryLower = query.toLowerCase();
  const usedTensions = new Set(
    segments
      .filter((_, index) => index !== currentSegmentIndex)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map(stripTensionNumber),
  );

  const beforeSegment = inner.slice(0, segmentStart);
  const afterSegment = inner.slice(segmentStart + currentSegment.length);

  const suggestions = TENSION_OPTIONS.filter(
    (option) => option.toLowerCase().startsWith(queryLower) && !usedTensions.has(stripTensionNumber(option)),
  ).map((option) => ({
    value: `${token.slice(0, openIndex + 1)}${beforeSegment}${option}${afterSegment}${closeIndex >= 0 ? token.slice(closeIndex) : ")"}`,
    label: option,
    detail: `${token.slice(0, openIndex + 1)}${beforeSegment}${option}${afterSegment}${closeIndex >= 0 ? token.slice(closeIndex) : ")"}`,
  }));

  return suggestions.length > 0 ? suggestions : null;
}

function buildBaseSuggestions(
  token: string,
  mode: NotationMode,
  key: KeyName,
): Pick<ChordAutocompleteMatch, "kind" | "suggestions"> | null {
  const rootOptions = getRootOptions(mode, key);
  const normalizedToken = token.toLowerCase();

  const matchingRoots = rootOptions
    .filter((root) => normalizedToken.startsWith(root.toLowerCase()))
    .sort((left, right) => right.length - left.length);

  for (const root of matchingRoots) {
    const suffixQuery = token.slice(root.length);
    const suggestions = BASE_CHORD_OPTIONS.filter((option) => option.suffix.startsWith(suffixQuery)).map((option) => ({
      value: `${root}${option.suffix}`,
      label: `${root}${option.suffix}`,
      detail: option.detail,
    }));

    if (suggestions.length > 0) {
      return {
        kind: "quality",
        suggestions,
      };
    }
  }

  const suggestions = rootOptions
    .filter((root) => root.toLowerCase().startsWith(normalizedToken))
    .map((root) => ({
      value: root,
      label: root,
      detail: "Root",
    }));

  return suggestions.length > 0
    ? {
        kind: "root",
        suggestions,
      }
    : null;
}

export function getChordAutocompleteMatch(
  value: string,
  caret: number,
  options: {
    key: KeyName;
    mode: NotationMode;
  },
): ChordAutocompleteMatch | null {
  const { token, tokenStart, tokenEnd, caretOffset } = getTokenBounds(value, caret);

  if (!token || token === "%" || /^x$/i.test(token) || token.includes("/")) {
    return null;
  }

  const tensionSuggestions = buildTensionSuggestions(token, caretOffset);
  if (tensionSuggestions) {
    return {
      kind: "tension",
      token,
      tokenStart,
      tokenEnd,
      suggestions: tensionSuggestions,
    };
  }

  const baseSuggestions = buildBaseSuggestions(token, options.mode, options.key);
  if (!baseSuggestions) {
    return null;
  }

  return {
    kind: baseSuggestions.kind,
    token,
    tokenStart,
    tokenEnd,
    suggestions: baseSuggestions.suggestions,
  };
}
