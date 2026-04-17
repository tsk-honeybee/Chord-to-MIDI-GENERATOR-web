import { splitMeasureText, type KeyName } from "./chord";

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

export function serializeChart(parts: ChartPart[]): string {
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

export function parseChartText(text: string): ParsedChartRow[] {
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

    while (currentPart.measures.length > 0 && !currentPart.measures[currentPart.measures.length - 1]) {
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
