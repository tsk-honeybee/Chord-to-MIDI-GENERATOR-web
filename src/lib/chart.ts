import {
  buildStringFromParsed,
  parseChordSymbol,
  splitMeasureText,
  type KeyName,
} from "./chord";

export interface ChartPart {
  id: string;
  part: string;
  key: KeyName;
  measures: string[];
}

export interface ParsedChartRow {
  part: string;
  key: string;
  measures: string[];
}

export type ChartTextFormat = "generic" | "chordwiki";

interface ChordWikiTokenMatch {
  raw: string;
  normalized: string;
  index: number;
}

interface ChordWikiCell {
  kind: "chord" | "placeholder" | "empty" | "text";
  measures: string[];
  rawText: string;
  tokens: ChordWikiTokenMatch[];
}

const CHORDWIKI_DIRECTIVE_PATTERN = /^\[\{\s*(?<name>[a-z_]+)\s*:\s*(?<value>.*?)\s*\}\]$/i;
const CHORDWIKI_KEY_LINE_PATTERN = /^Key\s*:\s*(.+)$/i;
const CHORDWIKI_PLACEHOLDER_PATTERN = /^[>\-.\s~]+$/;
const CHORDWIKI_CHORD_PATTERN =
  /([A-Ga-g](?:#|b)?(?:m7-5|add\d+|aug7|aug|dim7|dim|mM(?:7b5|7|9b5|9)|m(?:7b5|9b5|13|11|9|7|6)|maj(?:7b5|7|9|11|13)?|M(?:7b5|7|9b5|9|11|13)|9b5|m7b5|sus2|sus4|sus|m|[0-9+#b-]*)?(?:\([^)]*\))?(?:\/[A-Ga-g](?:#|b)?)?)/g;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `part-${Math.random().toString(36).slice(2, 10)}`;
}

export function createPart(key: KeyName = "C", measures = 8, part = ""): ChartPart {
  return {
    id: createId(),
    part,
    key,
    measures: Array.from({ length: measures }, () => ""),
  };
}

export function createDefaultParts(): ChartPart[] {
  return [
    {
      id: createId(),
      part: "",
      key: "C",
      measures: Array.from({ length: 16 }, () => ""),
    },
  ];
}

export function serializeChart(parts: ChartPart[], format: ChartTextFormat = "generic"): string {
  const lines: string[] = [];

  parts.forEach((part) => {
    const headerBits: string[] = [];
    if (part.part.trim()) {
      headerBits.push(`[${part.part.trim()}]`);
    }
    if (part.key.trim()) {
      headerBits.push(`(Key:${part.key.trim()})`);
    }

    if (headerBits.length > 0) {
      lines.push(headerBits.join(" "));
    }

    for (let index = 0; index < part.measures.length; index += 4) {
      const chunk = part.measures.slice(index, index + 4);
      lines.push(`| ${chunk.map((measure) => measure.trim()).join(" | ")} |`);
    }

    lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

function parseGenericChartText(text: string): ParsedChartRow[] {
  const rows: ParsedChartRow[] = [];
  let currentPart = "";
  let currentKey = "";
  let isFirstRowOfPart = true;
  let allMeasuresInPart: string[] = [];

  const commitPartMeasures = () => {
    if (allMeasuresInPart.length === 0) {
      return;
    }

    for (let index = 0; index < allMeasuresInPart.length; index += 4) {
      const chunk = allMeasuresInPart.slice(index, index + 4);
      rows.push({
        part: isFirstRowOfPart ? currentPart : "",
        key: isFirstRowOfPart ? currentKey : "",
        measures: chunk,
      });
      isFirstRowOfPart = false;
    }

    allMeasuresInPart = [];
  };

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();

    const chordWikiDirectiveMatch = line.match(/^\[\{\s*(?<name>[a-z_]+)\s*:\s*(?<value>.*?)\s*\}\]$/i);
    if (chordWikiDirectiveMatch?.groups) {
      const directiveName = chordWikiDirectiveMatch.groups.name.toLowerCase();
      const directiveValue = chordWikiDirectiveMatch.groups.value.trim();

      if (directiveName === "comment" || directiveName === "title") {
        commitPartMeasures();
        currentPart = directiveValue;
        isFirstRowOfPart = true;
        return;
      }

      if (directiveName === "key") {
        commitPartMeasures();
        currentKey = directiveValue;
        isFirstRowOfPart = true;
        return;
      }
    }

    const partKeyMatch = line.match(/^\[(?<part>[^\]]*)\]\s*(?<rest>.*)$/);
    if (partKeyMatch?.groups) {
      commitPartMeasures();
      const partText = partKeyMatch.groups.part.trim();
      const rest = partKeyMatch.groups.rest.trim();
      const comment = rest.replace(/\(\s*Key\s*:\s*[^\)]+\)/, "").trim();
      currentPart = comment ? `${partText} ${comment}`.trim() : partText;
      const keyMatch = rest.match(/\(\s*Key\s*:\s*([^\)]+)\)/);
      if (keyMatch) {
        currentKey = keyMatch[1].trim();
      }
      isFirstRowOfPart = true;
      return;
    }

    const keyOnlyMatch = line.match(/^\(\s*Key\s*:\s*([^\)]+)\)\s*$/);
    if (keyOnlyMatch) {
      commitPartMeasures();
      currentKey = keyOnlyMatch[1].trim();
      isFirstRowOfPart = true;
      return;
    }

    if (line.includes("|")) {
      allMeasuresInPart.push(...line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((segment) => segment.trim()));
      return;
    }

    if (!line) {
      commitPartMeasures();
      isFirstRowOfPart = true;
    }
  });

  commitPartMeasures();
  return rows;
}

function normalizeChordWikiToken(token: string, currentKey: string): string {
  const strippedToken = token.replace(/-+$/g, "");
  const normalizedToken = strippedToken.replace(
    /^([A-Ga-g])([#b]?)(.*?)(?:\/([A-Ga-g])([#b]?))?$/,
    (_, root: string, accidental: string, suffix: string, slashRoot?: string, slashAccidental?: string) =>
      `${root.toUpperCase()}${accidental}${suffix}${slashRoot ? `/${slashRoot.toUpperCase()}${slashAccidental ?? ""}` : ""}`,
  );

  if (/^[A-G](?:#|b)?m7-5(?:\/[A-G](?:#|b)?)?$/i.test(normalizedToken)) {
    return normalizedToken;
  }

  if (/^[A-G](?:#|b)?5(?:\/[A-G](?:#|b)?)?$/i.test(normalizedToken)) {
    return normalizedToken;
  }

  try {
    const parsed = parseChordSymbol(normalizedToken.replace(/^\((.*)\)$/, "$1"), (currentKey || "C") as KeyName);
    const normalizedChord = buildStringFromParsed(parsed, false, (currentKey || "C") as KeyName);
    const addMatch = normalizedToken.match(/add(\d+)/i);
    if (!addMatch) {
      return normalizedChord;
    }

    const addedTension = addMatch[1];
    if (normalizedChord.includes(`(${addedTension})`)) {
      return normalizedChord;
    }

    return normalizedChord.replace(
      new RegExp(`${addedTension}(?=(?:\\/[A-G](?:#|b)?)?$)`),
      `(${addedTension})`,
    );
  } catch {
    return normalizedToken.replace(/^\((.*)\)$/, "$1");
  }
}

function isValidChordWikiToken(source: string, token: string, index: number): boolean {
  const prevChar = index > 0 ? source[index - 1] : "";
  const nextIndex = index + token.length;
  const nextChar = nextIndex < source.length ? source[nextIndex] : "";

  if (/[A-Za-z0-9/#.]/.test(prevChar)) {
    return false;
  }

  if (/^[A-G](?:#|b)?$/i.test(token) && /[a-z]/.test(nextChar)) {
    return false;
  }

  return true;
}

function getChordWikiTokenMatches(source: string, currentKey: string): ChordWikiTokenMatch[] {
  return Array.from(source.matchAll(CHORDWIKI_CHORD_PATTERN))
    .map((match) => {
      const raw = match[1]?.trim() ?? "";
      const index = match.index ?? 0;
      return { raw, index };
    })
    .filter((match) => match.raw && isValidChordWikiToken(source, match.raw, match.index))
    .map((match) => ({
      raw: match.raw,
      normalized: normalizeChordWikiToken(match.raw, currentKey),
      index: match.index,
    }));
}

function isChordWikiSmartCodeLine(source: string, currentKey: string): boolean {
  const normalizedSource = source.replaceAll("\u3000", " ");
  const tokenMatches = getChordWikiTokenMatches(normalizedSource, currentKey);
  if (tokenMatches.length === 0) {
    return false;
  }

  const residualChars = Array.from(normalizedSource);
  tokenMatches.forEach((match) => {
    for (let index = match.index; index < match.index + match.raw.length; index += 1) {
      residualChars[index] = " ";
    }
  });

  const residual = residualChars
    .join("")
    .replace(/N\.C\./gi, " ")
    .replace(/[|>\-.\s]/g, "")
    .trim();

  return residual.length <= 1;
}

function isChordWikiBarGuideLine(source: string, currentKey: string): boolean {
  if ((source.match(/\|/g) ?? []).length < 2) {
    return false;
  }

  if (getChordWikiTokenMatches(source, currentKey).length > 0) {
    return false;
  }

  return source.replace(/N\.C\./gi, "").replace(/[|>\-.\s()A-Za-z]/g, "").trim().length === 0;
}

function buildChordWikiMeasuresFromGuideLine(
  codeLine: string,
  guideLine: string,
  currentKey: string,
  previousChord: string | null,
): { measures: string[]; nextPreviousChord: string | null } | null {
  const tokens = getChordWikiTokenMatches(codeLine, currentKey);
  const barPositions = Array.from(guideLine.matchAll(/\|/g)).map((match) => match.index ?? 0);

  if (tokens.length === 0 || barPositions.length < 2) {
    return null;
  }

  const measureBuckets = Array.from({ length: barPositions.length - 1 }, () => [] as string[]);
  tokens.forEach((token) => {
    let bucketIndex = measureBuckets.length - 1;
    for (let index = 0; index < barPositions.length - 1; index += 1) {
      if (token.index >= barPositions[index] && token.index < barPositions[index + 1]) {
        bucketIndex = index;
        break;
      }
    }

    measureBuckets[bucketIndex]?.push(token.normalized);
  });

  const measures: string[] = [];
  let lastChord = previousChord;
  measureBuckets.forEach((bucket, index) => {
    if (bucket.length > 0) {
      const measureText = bucket.join(" ");
      measures.push(measureText);
      lastChord = measureText;
      return;
    }

    const segment = guideLine.slice(barPositions[index], barPositions[index + 1]);
    if (/N\.C\./i.test(segment)) {
      measures.push("");
      return;
    }

    measures.push(lastChord ? "%" : "");
  });

  return {
    measures,
    nextPreviousChord: lastChord,
  };
}

function extractChordWikiCell(cellText: string, currentKey: string): ChordWikiCell {
  const normalized = cellText.replaceAll("\u3000", " ").trim();
  if (!normalized) {
    return {
      kind: "empty",
      measures: [""],
      rawText: cellText,
      tokens: [],
    };
  }

  const compact = normalized.replace(/\s+/g, "");
  const compactWithoutComments = compact.replace(/\([^)]*\)/g, "");
  if (
    CHORDWIKI_PLACEHOLDER_PATTERN.test(compact) ||
    (compactWithoutComments.length > 0 && CHORDWIKI_PLACEHOLDER_PATTERN.test(compactWithoutComments))
  ) {
    return {
      kind: "placeholder",
      measures: [""],
      rawText: cellText,
      tokens: [],
    };
  }

  const tokens = getChordWikiTokenMatches(normalized, currentKey);

  if (tokens.length > 0) {
    return {
      kind: "chord",
      measures: [tokens.map((token) => token.normalized).join(" ")],
      rawText: cellText,
      tokens,
    };
  }

  return {
    kind: "text",
    measures: [""],
    rawText: cellText,
    tokens: [],
  };
}

function normalizeChordWikiCells(cells: ChordWikiCell[]): ChordWikiCell[] {
  const nextCells = [...cells];

  while (
    nextCells.length > 0 &&
    nextCells[0] &&
    (nextCells[0].kind === "text" || nextCells[0].kind === "empty") &&
    nextCells.some((cell) => cell.kind === "chord" || cell.kind === "placeholder")
  ) {
    nextCells.shift();
  }

  while (
    nextCells.length > 0 &&
    nextCells[nextCells.length - 1] &&
    (nextCells[nextCells.length - 1].kind === "text" || nextCells[nextCells.length - 1].kind === "empty") &&
    nextCells.some((cell) => cell.kind === "chord" || cell.kind === "placeholder")
  ) {
    nextCells.pop();
  }

  while (nextCells.length > 0 && nextCells.length % 4 !== 0) {
    const lastCell = nextCells[nextCells.length - 1];
    if (lastCell && (lastCell.kind === "text" || lastCell.kind === "empty")) {
      nextCells.pop();
      continue;
    }

    const firstCell = nextCells[0];
    if (firstCell && (firstCell.kind === "text" || firstCell.kind === "empty")) {
      nextCells.shift();
      continue;
    }

    break;
  }

  if (nextCells.length === 3) {
    const firstCell = nextCells[0];
    if (firstCell?.tokens.length >= 2 && /-{2,}|>/.test(firstCell.rawText)) {
      const [firstToken, ...restTokens] = firstCell.tokens;
      nextCells.splice(
        0,
        1,
        {
          kind: "chord",
          measures: [firstToken.normalized],
          rawText: firstCell.rawText,
          tokens: [firstToken],
        },
        {
          kind: "chord",
          measures: [restTokens.map((token) => token.normalized).join(" ")],
          rawText: firstCell.rawText,
          tokens: restTokens,
        },
      );
    }
  }

  return nextCells;
}

function groupLooseChordWikiLine(source: string, matches: ChordWikiTokenMatch[]): string[] {
  if (matches.length === 0) {
    return [];
  }

  if (matches.length <= 2) {
    return matches.map((match) => match.normalized);
  }

  const gaps = matches.slice(0, -1).map((match, index) =>
    source.slice(match.index + match.raw.length, matches[index + 1].index),
  );
  const hasWhitespaceBoundary = gaps.some((gap) => /\s/.test(gap));
  if (!hasWhitespaceBoundary) {
    return matches.map((match) => match.normalized);
  }

  const midpoint = Math.ceil(matches.length / 2);
  return [
    matches.slice(0, midpoint).map((match) => match.normalized).join(" "),
    matches.slice(midpoint).map((match) => match.normalized).join(" "),
  ].filter(Boolean);
}

const CHORDWIKI_DYNAMIC_HEADING_PATTERN =
  /^(?:ppp?|mp|mf|fff?|sfz|cresc\.?|decresc\.?|dim\.?)$/i;

function extractChordWikiHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const bracketMatch = trimmed.match(/^\[(.+)\]$/);
  if (bracketMatch) {
    return bracketMatch[1]?.trim() || null;
  }

  if (!/^(?:\([^)]*\)\s*)+$/.test(trimmed)) {
    return null;
  }

  const segments = Array.from(trimmed.matchAll(/\(([^)]*)\)/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .filter((segment) => !CHORDWIKI_DYNAMIC_HEADING_PATTERN.test(segment));

  const grouped = segments.join(" ").trim();
  if (grouped) {
    return grouped;
  }

  return null;
}

function extractChordWikiPlainHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || /[|[\]{}]/.test(trimmed) || /^Key\s*:/i.test(trimmed)) {
    return null;
  }

  const compact = trimmed.replace(/\s+/g, " ");
  const dynamicSuffixMatch = compact.match(
    /^(.*?)(?:\s+|\s*\()\b(ppp?|mp|mf|fff?|sfz)\.?\)?$/i,
  );

  if (dynamicSuffixMatch?.[1]) {
    const heading = dynamicSuffixMatch[1].trim().replace(/[()]+$/g, "").trim();
    return heading || null;
  }

  return null;
}

export function hasAmbiguousChartText(text: string, format: ChartTextFormat = "generic"): boolean {
  if (format !== "chordwiki") {
    return false;
  }

  let currentKey = "C";
  let skipNextSmartLyricLine = false;

  return text.split(/\r?\n/).some((rawLine) => {
    const normalizedLine = rawLine.replaceAll("\u3000", " ");
    const line = normalizedLine.trim();
    if (!line) {
      skipNextSmartLyricLine = false;
      return false;
    }

    const directiveMatch = line.match(CHORDWIKI_DIRECTIVE_PATTERN);
    if (directiveMatch?.groups) {
      if (directiveMatch.groups.name.toLowerCase() === "key") {
        currentKey = directiveMatch.groups.value.trim();
      }
      skipNextSmartLyricLine = false;
      return false;
    }

    const keyMatch = line.match(CHORDWIKI_KEY_LINE_PATTERN);
    if (keyMatch) {
      currentKey = keyMatch[1].trim();
      skipNextSmartLyricLine = false;
      return false;
    }

    if (extractChordWikiHeading(line) || extractChordWikiPlainHeading(line)) {
      skipNextSmartLyricLine = false;
      return false;
    }

    const isSmartCodeLine = isChordWikiSmartCodeLine(normalizedLine, currentKey);
    if (skipNextSmartLyricLine && !isSmartCodeLine) {
      skipNextSmartLyricLine = false;
      return false;
    }

    if (isSmartCodeLine) {
      skipNextSmartLyricLine = true;
      return false;
    }

    if (line.includes("|")) {
      return false;
    }

    return getChordWikiTokenMatches(normalizedLine, currentKey).length > 0;
  });
}

function parseChordWikiChartText(text: string): ParsedChartRow[] {
  const rows: ParsedChartRow[] = [];
  let currentPart = "";
  let currentKey = "";
  let isFirstRowOfPart = true;
  let previousChord: string | null = null;
  let skipNextSmartLyricLine = false;
  const lines = text.split(/\r?\n/);

  const pushRow = (measures: string[]) => {
    if (measures.length === 0) {
      return;
    }

    rows.push({
      part: isFirstRowOfPart ? currentPart : "",
      key: isFirstRowOfPart ? currentKey : "",
      measures,
    });
    isFirstRowOfPart = false;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const normalizedLine = lines[lineIndex].replaceAll("\u3000", " ");
    const line = normalizedLine.trim();

    if (!line) {
      skipNextSmartLyricLine = false;
      continue;
    }

    const directiveMatch = line.match(CHORDWIKI_DIRECTIVE_PATTERN);
    if (directiveMatch?.groups) {
      const directiveName = directiveMatch.groups.name.toLowerCase();
      const directiveValue = directiveMatch.groups.value.trim();

      if (directiveName === "comment" || directiveName === "title") {
        currentPart = directiveValue;
        isFirstRowOfPart = true;
        skipNextSmartLyricLine = false;
        continue;
      }

      if (directiveName === "key") {
        currentKey = directiveValue;
        isFirstRowOfPart = true;
        skipNextSmartLyricLine = false;
        continue;
      }
    }

    const keyMatch = line.match(CHORDWIKI_KEY_LINE_PATTERN);
    if (keyMatch) {
      currentKey = keyMatch[1].trim();
      isFirstRowOfPart = true;
      skipNextSmartLyricLine = false;
      continue;
    }

    const heading = extractChordWikiHeading(line) ?? extractChordWikiPlainHeading(line);
    if (heading) {
      currentPart = heading;
      isFirstRowOfPart = true;
      skipNextSmartLyricLine = false;
      continue;
    }

    const isSmartCodeLine = isChordWikiSmartCodeLine(normalizedLine, currentKey);
    if (skipNextSmartLyricLine && !isSmartCodeLine) {
      skipNextSmartLyricLine = false;
      continue;
    }

    let nextNonEmptyIndex = -1;
    for (let index = lineIndex + 1; index < lines.length; index += 1) {
      if (lines[index].trim()) {
        nextNonEmptyIndex = index;
        break;
      }
    }

    const nextNonEmptyLine =
      nextNonEmptyIndex >= 0 ? lines[nextNonEmptyIndex].replaceAll("\u3000", " ") : null;

    if (
      isSmartCodeLine &&
      !line.includes("|") &&
      nextNonEmptyLine &&
      isChordWikiBarGuideLine(nextNonEmptyLine, currentKey)
    ) {
      const guidedMeasures = buildChordWikiMeasuresFromGuideLine(
        normalizedLine,
        nextNonEmptyLine,
        currentKey,
        previousChord,
      );

      if (guidedMeasures) {
        pushRow(guidedMeasures.measures);
        previousChord = guidedMeasures.nextPreviousChord;
        skipNextSmartLyricLine = false;
        lineIndex = nextNonEmptyIndex;
        continue;
      }
    }

    if (line.includes("|")) {
      const rawCells = line.replace(/^\|/, "").replace(/\|$/, "").split("|");
      const measureCells = normalizeChordWikiCells(rawCells.map((cell) => extractChordWikiCell(cell.trimEnd(), currentKey)));
      if (measureCells.length === 0) {
        continue;
      }

      let currentRow: string[] = [];
      let currentRowCells: ChordWikiCell[] = [];
      const flushCurrentRow = () => {
        if (currentRowCells.length === 0) {
          return;
        }

        const hasChordOrPlaceholder = currentRowCells.some(
          (entry) => entry.kind === "chord" || entry.kind === "placeholder",
        );
        if (!hasChordOrPlaceholder) {
          currentRowCells = [];
          currentRow = [];
          return;
        }

        const hasTextCell = currentRowCells.some((entry) => entry.kind === "text");

        currentRowCells.forEach((entry) => {
          if (entry.kind === "chord") {
            entry.measures.forEach((measure) => {
              currentRow.push(measure);
              previousChord = measure;
            });
            return;
          }

          if (entry.kind === "placeholder") {
            currentRow.push(!hasTextCell && previousChord ? "%" : "");
            return;
          }

          currentRow.push("");
        });

        pushRow(currentRow);
        currentRow = [];
        currentRowCells = [];
      };

      measureCells.forEach((cell) => {
        currentRowCells.push(cell);

        if (currentRowCells.length === 4) {
          flushCurrentRow();
        }
      });
      flushCurrentRow();
      skipNextSmartLyricLine = isSmartCodeLine;
      continue;
    }

    const looseLineMatches = getChordWikiTokenMatches(normalizedLine, currentKey);
    if (looseLineMatches.length > 0) {
      pushRow(groupLooseChordWikiLine(normalizedLine, looseLineMatches));
      previousChord = looseLineMatches[looseLineMatches.length - 1]?.normalized ?? previousChord;
      skipNextSmartLyricLine = isSmartCodeLine;
      continue;
    }

    currentPart = line;
    isFirstRowOfPart = true;
    skipNextSmartLyricLine = false;
  }

  return rows;
}

export function parseChartText(
  text: string,
  format: ChartTextFormat = "generic",
): ParsedChartRow[] {
  if (format === "chordwiki") {
    return parseChordWikiChartText(text);
  }

  return parseGenericChartText(text);
}

export function formatChartText(text: string): string {
  const lines = text.split("\n");
  let formattedLines: string[] = [];
  let blockLines: { index: number; cells: string[] }[] = [];

  const processBlock = () => {
    if (blockLines.length === 0) return;

    const columnWidths: number[] = [];
    blockLines.forEach((item) => {
      item.cells.forEach((cell, colIndex) => {
        if (colIndex === 0 && cell === "") return;
        if (colIndex === item.cells.length - 1 && cell === "") return;
        columnWidths[colIndex] = Math.max(columnWidths[colIndex] || 0, cell.length);
      });
    });

    blockLines.forEach((item) => {
      const formattedCells = item.cells.map((cell, colIndex) => {
        if (colIndex === 0 && cell === "") return "";
        if (colIndex === item.cells.length - 1 && cell === "") return "";
        return cell.padEnd(columnWidths[colIndex] || 0, " ");
      });
      formattedLines[item.index] = formattedCells.join("|");
    });
    blockLines = [];
  };

  lines.forEach((line, i) => {
    if (line.includes("|")) {
      const rawCells = line.split("|");
      const cells = rawCells.map((s, colIndex) => {
        const trimmed = s.trim();
        if (trimmed === "") {
          if (colIndex > 0 && colIndex < rawCells.length - 1) return "  ";
          return "";
        }
        return ` ${trimmed} `;
      });
      blockLines.push({ index: i, cells });
      formattedLines.push(line);
    } else {
      processBlock();
      formattedLines.push(line);
    }
  });
  processBlock();

  return formattedLines.join("\n");
}

export function rowsToParts(rows: ParsedChartRow[]): ChartPart[] {
  if (rows.length === 0) {
    return createDefaultParts();
  }

  const parts: ChartPart[] = [];
  let currentPart: ChartPart | null = null;
  let lastKey: KeyName = "C";

  const commitPart = () => {
    if (!currentPart) {
      return;
    }

    while (
      currentPart.measures.length > 0 &&
      currentPart.measures.length % 4 !== 0 &&
      !currentPart.measures[currentPart.measures.length - 1]
    ) {
      currentPart.measures.pop();
    }

    if (currentPart.measures.length > 0) {
      parts.push(currentPart);
    }
  };

  rows.forEach((row) => {
    let isNewPart = Boolean(row.part);
    if (!isNewPart && row.key && currentPart && row.key !== currentPart.key) {
      isNewPart = true;
    }

    if (isNewPart || !currentPart) {
      commitPart();
      currentPart = {
        id: createId(),
        part: row.part ?? "",
        key: ((row.key || lastKey) as KeyName) ?? "C",
        measures: [],
      };
    }

    currentPart.measures.push(...row.measures);
    lastKey = currentPart.key;
  });

  commitPart();

  return parts.length > 0 ? parts : createDefaultParts();
}

export function countFilledMeasures(parts: ChartPart[]): number {
  return parts.flatMap((part) => part.measures).filter((measure) => measure.trim()).length;
}

export function countChordTokens(parts: ChartPart[]): number {
  return parts
    .flatMap((part) => part.measures)
    .reduce((count, measure) => count + splitMeasureText(measure).length, 0);
}
