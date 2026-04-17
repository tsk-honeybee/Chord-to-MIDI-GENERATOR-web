import {
  startTransition,
  useEffect,
  useDeferredValue,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FocusEvent as ReactFocusEvent,
} from "react";
import {
  countChordTokens,
  countFilledMeasures,
  createDefaultParts,
  createPart,
  formatChartText,
  hasAmbiguousChartText,
  parseChartText,
  rowsToParts,
  serializeChart,
  type ChartTextFormat,
  type ChartPart,
} from "./lib/chart";
import {
  MAJOR_KEYS,
  MINOR_KEYS,
  QUALITY_SYMBOLS,
  TENSIONS_LIST,
  VOICING_STYLES,
  buildStringFromParsed,
  buildVoicing,
  convertMeasureText,
  getNoteNamesForKey,
  midiToDisplayName,
  parseChordSymbol,
  romanDegreesForKey,
  splitMeasureText,
  type KeyName,
  type NotationMode,
  type VoicingStyle,
} from "./lib/chord";
import { playChordPreview, startHeldChordPreview, stopChordPreview } from "./lib/audioPreview";
import { downloadBlob, exportChartToMidi } from "./lib/midi";
import { applyPwaUpdate, subscribeToPwaRefresh } from "./lib/pwa";

interface PersistedState {
  mode: NotationMode;
  parts: ChartPart[];
  settings: ExportSettings;
  chartFormat?: ChartTextFormat;
}

interface BuilderState {
  root: string;
  quality: string;
  tensions: string[];
}

interface DialogAction {
  label: string;
  variant?: "primary" | "ghost";
  onClick: () => void;
}

interface AppDialogState {
  title: string;
  message: string;
  actions: DialogAction[];
}

interface PreviewRow {
  id: string;
  label: string;
  detail: string;
  notes: string[];
  midiNotes: number[];
  status: "ok" | "error" | "muted";
}

interface ExportSettings {
  omit5OnConflict: boolean;
  omitDuplicatedBass: boolean;
  voicingStyle: VoicingStyle;
  voicingOctaveShift: number;
  previewEnabled: boolean;
  previewVolume: number;
}

const STORAGE_KEY = "chord-to-midi-generator-pwa";
const UI_SCALE_STORAGE_KEY = "chord-to-midi-generator-ui-scale";
const CHART_FORMAT_OPTIONS: { value: ChartTextFormat; label: string }[] = [
  { value: "generic", label: "범용" },
  { value: "chordwiki", label: "ChordWiki" },
];
const CHART_PLACEHOLDER = `[intro] (Key:C)
| FM7 | G7 | Em7 | Am7 |
| FM7 | G7 | Am7 | % |

[A] (Key:Eb)
| Eb | % | AbM7 | Abm7 |
| Eb | Eb Eb/Ab | AbM7 | Abm7 |`;
const CHORDWIKI_PLACEHOLDER = `Key: Bb

[Key. & Drums. only] (Key:Bb)

| (Bb) > N.C. --- ----ちょっとだけ| こわい | (Bb) > N.C. --- ----の| ---- ---- |

[All in] (Key:Bb)

| BbなんF/Aとなく| Gm知っGm7/Fてる け| Ebadd9どBb/D自信(じし| Cm7ん)がF7ない| (↓)よ`;
const HELP_BASICS = [
  "마디 칸을 클릭 한 뒤 텍스트로 코드를 적을 수 있습니다. 각 코드는 공백으로 구분됩니다. 예: C G/B Am7 F",
  "**슬래시(/)** 는 베이스음을 지정합니다. 예: C/E 는 C 코드에 베이스 E입니다.",
  "**omit3**, **omit5** 로 3음과 5음을 생략할 수 있습니다. 예: C7omit3",
  "**%** 는 이전 마디를 반복하고, **x** 또는 빈 마디는 쉬는 마디로 취급합니다.",
];
const HELP_FEATURE_DETAILS = [
  "상단의 `알파벳/로마자 전환`으로 코드 표기 방식을 바꿀 수 있습니다.",
  "`보이싱`, `옥타브`, `정리 옵션`으로 MIDI 재생 형태를 조정할 수 있습니다.",
  "오른쪽 `코드 삽입`에서 선택한 마디에 코드를 빠르게 만들어 넣을 수 있습니다.",
  "모든 코드는 **한 옥타브 낮은 베이스음**과 함께 재생됩니다.",
  "완성된 진행은 `MIDI 저장`, `차트 저장`으로 각각 저장할 수 있습니다.",
];
const HELP_TEXT_RULES = [
  "**[파트 이름]** : Intro, Verse 같은 파트 이름을 대괄호로 적습니다.",
  "**(Key:키)** : 파트의 키 정보를 소괄호와 Key: 형식으로 적습니다.",
  "**|** : 마디를 구분하는 기호입니다. 한 줄은 보통 4마디 기준으로 씁니다.",
  "**%** : 바로 이전 마디 코드를 그대로 반복합니다.",
  "**공백** : 한 마디 안에 여러 코드를 넣을 때 공백으로 구분합니다.",
];
const HELP_CHART_EXAMPLE = `[intro] (Key:C)
| FM7    | G7    | Em7    | Am7   |
| FM7    | G7    | Am7    | %     |

[A] (Key:Eb)
| Eb     | %          | AbM7   | Abm7  |
| Eb     | Eb Eb/Ab   | AbM7   | Abm7  |`;

function renderHighlightedText(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <span className="help-chip help-chip--accent" key={`${part}-${index}`}>
          {part.slice(1, -1)}
        </span>
      );
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <span className="help-chip help-chip--syntax" key={`${part}-${index}`}>
          {part.slice(2, -2)}
        </span>
      );
    }

    if (part.includes("예:")) {
      const [beforeExample, example] = part.split(/(예:\s*.*)/, 2);
      return (
        <span key={`${part}-${index}`}>
          {beforeExample}
          {example ? <span className="help-inline-example">{example}</span> : null}
        </span>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function resolveChordToken(
  parts: ChartPart[],
  target: {
    partId: string;
    measureIndex: number;
    tokenIndex: number;
  },
): string | null {
  let lastResolvedChord: string | null = null;

  for (const part of parts) {
    for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex += 1) {
      const measureText = part.measures[measureIndex].trim();

      if (!measureText || measureText.toLowerCase() === "x") {
        if (part.id === target.partId && measureIndex === target.measureIndex) {
          return null;
        }
        continue;
      }

      const tokens = splitMeasureText(measureText);
      for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
        const token = tokens[tokenIndex];
        const resolvedChord: string | null = token === "%" ? lastResolvedChord : token;

        if (
          part.id === target.partId &&
          measureIndex === target.measureIndex &&
          tokenIndex === target.tokenIndex
        ) {
          return resolvedChord;
        }

        if (resolvedChord) {
          lastResolvedChord = resolvedChord;
        }
      }

      if (part.id === target.partId && measureIndex === target.measureIndex) {
        return null;
      }
    }
  }

  return null;
}

function buildPreviewRow(
  parts: ChartPart[],
  selectedMeasure: { partId: string; measureIndex: number },
  selectedKey: KeyName,
  settings: ExportSettings,
  mode: NotationMode,
  token: string,
  tokenIndex: number,
): PreviewRow {
  const rowId = `${selectedMeasure.partId}-${selectedMeasure.measureIndex}-${tokenIndex}`;
  const resolvedToken =
    token === "%"
      ? resolveChordToken(parts, {
          partId: selectedMeasure.partId,
          measureIndex: selectedMeasure.measureIndex,
          tokenIndex,
        })
      : token;

  if (!resolvedToken) {
    return {
      id: rowId,
      label: token,
      detail: "반복할 이전 코드가 없습니다.",
      notes: [],
      midiNotes: [],
      status: "muted",
    };
  }

  try {
    const parsed = parseChordSymbol(resolvedToken, selectedKey);
    const voicing = buildVoicing(parsed, {
      ...settings,
      lastTopNote: null,
    });
    const renderedSymbol = buildStringFromParsed(parsed, mode === "degree", selectedKey);

    return {
      id: rowId,
      label: token,
      detail: token === "%" ? `이전 코드 반복: ${renderedSymbol}` : `인식된 내용: ${renderedSymbol}`,
      notes: voicing.map((note) => midiToDisplayName(note, selectedKey)),
      midiNotes: voicing,
      status: "ok",
    };
  } catch {
    return {
      id: rowId,
      label: token,
      detail: "해석할 수 없는 코드입니다.",
      notes: [],
      midiNotes: [],
      status: "error",
    };
  }
}

const DEFAULT_SETTINGS: ExportSettings = {
  omit5OnConflict: true,
  omitDuplicatedBass: false,
  voicingStyle: "Default",
  voicingOctaveShift: 0,
  previewEnabled: false,
  previewVolume: 0.72,
};

function createFallbackId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `part-${Math.random().toString(36).slice(2, 10)}`;
}

function getMeasureTokenFontSize(label: string, tokenCount: number): CSSProperties | undefined {
  let fontSize = 0.96;

  if (tokenCount >= 2) {
    fontSize -= 0.04;
  }

  if (tokenCount >= 3) {
    fontSize -= 0.04;
  }

  if (label.length >= 5) {
    fontSize -= 0.04;
  }

  if (label.length >= 7) {
    fontSize -= 0.04;
  }

  return {
    fontSize: `${Math.max(0.76, fontSize)}rem`,
  };
}

function getMeasureInputFontSize(value: string): CSSProperties | undefined {
  const tokenCount = splitMeasureText(value).length;
  const compactValue = value.replaceAll(" ", "");
  let fontSize = 0.98;

  if (tokenCount >= 2) {
    fontSize -= 0.06;
  }

  if (tokenCount >= 3) {
    fontSize -= 0.06;
  }

  if (compactValue.length >= 8) {
    fontSize -= 0.05;
  }

  if (compactValue.length >= 12) {
    fontSize -= 0.05;
  }

  return {
    fontSize: `${Math.max(0.78, fontSize)}rem`,
  };
}

function normalizePersistedState(): PersistedState {
  if (typeof window === "undefined") {
    return {
      mode: "alphabet",
      parts: createDefaultParts(),
      settings: DEFAULT_SETTINGS,
      chartFormat: "generic",
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        mode: "alphabet",
        parts: createDefaultParts(),
        settings: DEFAULT_SETTINGS,
        chartFormat: "generic",
      };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const parts =
      parsed.parts?.map((part) => ({
        id: part.id || createFallbackId(),
        part: part.part ?? "",
        key: (part.key ?? "C") as KeyName,
        measures: Array.isArray(part.measures) && part.measures.length > 0 ? part.measures : ["", "", "", ""],
      })) ?? createDefaultParts();

    return {
      mode: parsed.mode === "degree" ? "degree" : "alphabet",
      parts,
      settings: {
        omit5OnConflict: parsed.settings?.omit5OnConflict ?? DEFAULT_SETTINGS.omit5OnConflict,
        omitDuplicatedBass: parsed.settings?.omitDuplicatedBass ?? DEFAULT_SETTINGS.omitDuplicatedBass,
        voicingStyle: parsed.settings?.voicingStyle ?? DEFAULT_SETTINGS.voicingStyle,
        voicingOctaveShift: parsed.settings?.voicingOctaveShift ?? DEFAULT_SETTINGS.voicingOctaveShift,
        previewEnabled: parsed.settings?.previewEnabled ?? DEFAULT_SETTINGS.previewEnabled,
        previewVolume: parsed.settings?.previewVolume ?? DEFAULT_SETTINGS.previewVolume,
      },
      chartFormat: parsed.chartFormat === "chordwiki" ? "chordwiki" : "generic",
    };
  } catch {
    return {
      mode: "alphabet",
      parts: createDefaultParts(),
      settings: DEFAULT_SETTINGS,
      chartFormat: "generic",
    };
  }
}

function ChartTextarea({
  value,
  onValueChange,
  onBlur,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onBlur: () => void;
  placeholder: string;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = e.currentTarget.scrollTop;
      backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const highlighted = value.split(/(\|)/g).map((part, i) => {
    if (part === "|") {
      return (
        <span key={i} className="syntax-pipe">
          |
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });

  const finalHighlighted = value.endsWith("\n") ? [...highlighted, <br key="br" />] : highlighted;

  return (
    <div className="syntax-container">
      <div className="syntax-backdrop chart-textarea" ref={backdropRef} aria-hidden="true">
        {finalHighlighted}
      </div>
      <textarea
        className="syntax-textarea chart-textarea"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={() => onBlur()}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}

function KeyDropdown({ value, onChange }: { value: KeyName; onChange: (v: KeyName) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeMenu, setActiveMenu] = useState<"major" | "minor" | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mouseLocs = useRef<{ x: number; y: number }[]>([]);

  const handleMouseMove = (e: React.MouseEvent) => {
    mouseLocs.current.push({ x: e.clientX, y: e.clientY });
    if (mouseLocs.current.length > 8) {
      mouseLocs.current.shift();
    }
  };

  const getSlope = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    return (b.y - a.y) / (b.x - a.x);
  };

  const handleItemMouseEnter = (menu: "major" | "minor") => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (!activeMenu) {
      setActiveMenu(menu);
      return;
    }

    const loc = mouseLocs.current[mouseLocs.current.length - 1];
    const prevLoc = mouseLocs.current[0];

    if (!loc || !prevLoc) {
      setActiveMenu(menu);
      return;
    }

    // Check if moving toward the right (where submenus are)
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Submenu is to the right. We check if the slope points into the submenu area.
    // This is a simplified version of the Amazon algorithm.
    const isMovingRight = loc.x > prevLoc.x;
    
    if (isMovingRight) {
      // Moving toward submenu, delay the switch
      timeoutRef.current = setTimeout(() => {
        setActiveMenu(menu);
      }, 300);
    } else {
      // Vertical or left move, switch instantly
      setActiveMenu(menu);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="custom-dropdown" ref={containerRef}>
      <button className="custom-dropdown__trigger" onClick={() => setIsOpen(!isOpen)} title="키 선택">
        {value}
        <svg viewBox="0 0 24 24" width="16" height="16" className="dropdown-arrow">
          <path d="M7 10l5 5 5-5z" fill="currentColor" />
        </svg>
      </button>

      {isOpen && (
        <div 
          className="custom-dropdown__menu" 
          onMouseMove={handleMouseMove}
        >
          <div 
            className={`custom-dropdown__item has-submenu ${activeMenu === "major" ? "is-active" : ""}`}
            onMouseEnter={() => handleItemMouseEnter("major")}
          >
            <span>Major</span>
            <span className="arrow">▸</span>
            {activeMenu === "major" && (
              <div className="custom-dropdown__submenu">
                {MAJOR_KEYS.map((k) => (
                  <button
                    key={k}
                    className="custom-dropdown__option"
                    onClick={() => {
                      onChange(k);
                      setIsOpen(false);
                      setActiveMenu(null);
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div 
            className={`custom-dropdown__item has-submenu ${activeMenu === "minor" ? "is-active" : ""}`}
            onMouseEnter={() => handleItemMouseEnter("minor")}
          >
            <span>Minor</span>
            <span className="arrow">▸</span>
            {activeMenu === "minor" && (
              <div className="custom-dropdown__submenu">
                {MINOR_KEYS.map((k) => (
                  <button
                    key={k}
                    className="custom-dropdown__option"
                    onClick={() => {
                      onChange(k);
                      setIsOpen(false);
                      setActiveMenu(null);
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const persisted = normalizePersistedState();
  const [mode, setMode] = useState<NotationMode>(persisted.mode);
  const [parts, setParts] = useState<ChartPart[]>(persisted.parts);
  const [settings, setSettings] = useState<ExportSettings>(persisted.settings);
  const [chartFormat, setChartFormat] = useState<ChartTextFormat>(persisted.chartFormat ?? "generic");
  const [chartDraft, setChartDraft] = useState<string>(
    serializeChart(persisted.parts, persisted.chartFormat ?? "generic"),
  );
  const [autoFormatChart, setAutoFormatChart] = useState(false);
  const [chartSource, setChartSource] = useState<"grid" | "text">("grid");
  const [selectedMeasure, setSelectedMeasure] = useState({
    partId: persisted.parts[0]?.id ?? "",
    measureIndex: 0,
  });
  const [builder, setBuilder] = useState<BuilderState>({
    root: "C",
    quality: "Major",
    tensions: [],
  });
  const [partNameDrafts, setPartNameDrafts] = useState<Record<string, string>>({});
  const [partNameComposing, setPartNameComposing] = useState<Record<string, boolean>>({});
  const [measureSteps, setMeasureSteps] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [dialogState, setDialogState] = useState<AppDialogState | null>(null);
  const [isUpdateReady, setIsUpdateReady] = useState(false);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const [manualScale, setManualScale] = useState<number>(() => {
    if (typeof window === "undefined") {
      return 1;
    }

    const raw = window.localStorage.getItem(UI_SCALE_STORAGE_KEY);
    const parsed = raw ? Number.parseFloat(raw) : 1;
    if (Number.isNaN(parsed)) {
      return 1;
    }

    return Math.min(1.35, Math.max(0.7, parsed));
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const [playingPreviewId, setPlayingPreviewId] = useState<string | null>(null);

  const showToast = useEffectEvent((message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  });

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
      stopChordPreview();
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode,
        parts,
        settings,
        chartFormat,
      }),
    );
  }, [mode, parts, settings, chartFormat]);

  useEffect(() => {
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(manualScale));
  }, [manualScale]);

  useEffect(() => {
    if (chartSource === "grid") {
      const serialized = serializeChart(parts, chartFormat);
      setChartDraft(autoFormatChart ? formatChartText(serialized) : serialized);
    }
  }, [parts, chartSource, autoFormatChart, chartFormat]);

  useEffect(() => {
    if (settings.previewEnabled) {
      return;
    }

    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    stopChordPreview();
    setPlayingPreviewId(null);
  }, [settings.previewEnabled]);

  useEffect(() => {
    if (!isHelpOpen && !dialogState) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dialogState) {
          setDialogState(null);
          return;
        }

        setIsHelpOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dialogState, isHelpOpen]);

  useEffect(() => {
    return subscribeToPwaRefresh(() => {
      setIsUpdateReady(true);
    });
  }, []);

  useEffect(() => {
    const activePart = parts.find((part) => part.id === selectedMeasure.partId) ?? parts[0];
    if (!activePart) {
      return;
    }

    if (activePart.id !== selectedMeasure.partId) {
      setSelectedMeasure({ partId: activePart.id, measureIndex: 0 });
      return;
    }

    if (selectedMeasure.measureIndex >= activePart.measures.length) {
      setSelectedMeasure({
        partId: activePart.id,
        measureIndex: Math.max(0, activePart.measures.length - 1),
      });
    }
  }, [parts, selectedMeasure]);

  const selectedPart = parts.find((part) => part.id === selectedMeasure.partId) ?? parts[0];
  const selectedPartIndex = selectedPart ? parts.findIndex((part) => part.id === selectedPart.id) : -1;
  const selectedKey = selectedPart?.key ?? "C";
  const selectedMeasureText = selectedPart?.measures[selectedMeasure.measureIndex] ?? "";
  const builderRootOptions = mode === "degree" ? romanDegreesForKey(selectedKey) : getNoteNamesForKey(selectedKey);
  const deferredUpdateReady = useDeferredValue(isUpdateReady);

  useEffect(() => {
    if (!builderRootOptions.includes(builder.root)) {
      setBuilder((current) => ({
        ...current,
        root: builderRootOptions[0] ?? "C",
      }));
    }
  }, [builder.root, builderRootOptions]);

  const totalMeasures = parts.reduce((sum, part) => sum + part.measures.length, 0);
  const filledMeasures = countFilledMeasures(parts);
  const totalChordTokens = countChordTokens(parts);
  const selectedMeasureTokens = splitMeasureText(selectedMeasureText);
  const canMovePrev = selectedPartIndex > 0 || selectedMeasure.measureIndex > 0;
  const canMoveNext =
    selectedPartIndex >= 0 &&
    (selectedPartIndex < parts.length - 1 ||
      selectedMeasure.measureIndex < (selectedPart?.measures.length ?? 1) - 1);

  const previewRows: PreviewRow[] = selectedMeasureTokens.map((token, tokenIndex) =>
    buildPreviewRow(parts, selectedMeasure, selectedKey, settings, mode, token, tokenIndex),
  );

  const updatePart = (partId: string, updater: (part: ChartPart) => ChartPart) => {
    setChartSource("grid");
    setParts((current) => current.map((part) => (part.id === partId ? updater(part) : part)));
  };

  const handleMeasureChange = (partId: string, measureIndex: number, value: string) => {
    updatePart(partId, (part) => ({
      ...part,
      measures: part.measures.map((measure, index) => (index === measureIndex ? value : measure)),
    }));
  };

  const commitPartName = (partId: string, value: string) => {
    setChartSource("grid");
    setParts((current) =>
      current.map((part) => (part.id === partId ? { ...part, part: value } : part)),
    );
  };

  const handlePartNameChange = (partId: string, value: string) => {
    setPartNameDrafts((current) => ({
      ...current,
      [partId]: value,
    }));

    if (!partNameComposing[partId]) {
      commitPartName(partId, value);
    }
  };

  const finishPartNameEdit = (partId: string, value: string) => {
    commitPartName(partId, value);
    setPartNameDrafts((current) => {
      const next = { ...current };
      delete next[partId];
      return next;
    });
    setPartNameComposing((current) => {
      const next = { ...current };
      delete next[partId];
      return next;
    });
  };

  const handlePartKeyChange = (partId: string, nextKey: KeyName) => {
    const part = parts.find((entry) => entry.id === partId);
    if (!part) {
      return;
    }

    setChartSource("grid");
    startTransition(() => {
      setParts((current) =>
        current.map((entry) => {
          if (entry.id !== partId) {
            return entry;
          }

          if (mode === "degree" && entry.key !== nextKey) {
            return {
              ...entry,
              key: nextKey,
              measures: entry.measures.map((measure) =>
                splitMeasureText(measure)
                  .map((token) => {
                    if (token === "%") {
                      return token;
                    }

                    try {
                      const parsed = parseChordSymbol(token, entry.key);
                      return buildStringFromParsed(parsed, true, nextKey);
                    } catch {
                      return token;
                    }
                  })
                  .join(" "),
              ),
            };
          }

          return { ...entry, key: nextKey };
        }),
      );
    });
  };

  const handleModeChange = (nextMode: NotationMode) => {
    if (nextMode === mode) {
      return;
    }

    setChartSource("grid");
    startTransition(() => {
      setParts((current) =>
        current.map((part) => ({
          ...part,
          measures: part.measures.map((measure) => convertMeasureText(measure, part.key, nextMode)),
        })),
      );
      setMode(nextMode);
    });
    showToast(nextMode === "degree" ? "도수 표기로 변환했습니다." : "알파벳 표기로 변환했습니다.");
  };

  const handleAddPart = (afterPartId?: string) => {
    const sourcePart = afterPartId ? parts.find((part) => part.id === afterPartId) : undefined;
    const lastKey = sourcePart?.key ?? parts[parts.length - 1]?.key ?? "C";
    const nextPart = createPart(lastKey, 8);
    setChartSource("grid");
    startTransition(() => {
      setParts((current) => {
        if (!afterPartId) {
          return [...current, nextPart];
        }

        const sourceIndex = current.findIndex((part) => part.id === afterPartId);
        if (sourceIndex < 0) {
          return [...current, nextPart];
        }

        const nextParts = [...current];
        nextParts.splice(sourceIndex + 1, 0, nextPart);
        return nextParts;
      });
      setSelectedMeasure({ partId: nextPart.id, measureIndex: 0 });
    });
  };

  const handleDeletePart = (partId: string) => {
    if (parts.length <= 1) {
      const resetParts = createDefaultParts();
      setChartSource("grid");
      startTransition(() => {
        setParts(resetParts);
        setSelectedMeasure({ partId: resetParts[0].id, measureIndex: 0 });
      });
      return;
    }

    setChartSource("grid");
    startTransition(() => {
      const nextParts = parts.filter((part) => part.id !== partId);
      setParts(nextParts);
      if (selectedMeasure.partId === partId && nextParts[0]) {
        setSelectedMeasure({ partId: nextParts[0].id, measureIndex: 0 });
      }
    });
  };

  const handleMeasureStepChange = (partId: string, value: number) => {
    setMeasureSteps((current) => ({
      ...current,
      [partId]: Number.isNaN(value) ? 4 : Math.max(1, value),
    }));
  };

  const handleAddMeasures = (partId: string) => {
    const step = Math.max(1, measureSteps[partId] ?? 4);
    updatePart(partId, (part) => ({
      ...part,
      measures: [...part.measures, ...Array.from({ length: step }, () => "")],
    }));
  };

  const handleRemoveMeasures = (partId: string) => {
    const step = Math.max(1, measureSteps[partId] ?? 4);
    updatePart(partId, (part) => ({
      ...part,
      measures: part.measures.slice(0, Math.max(4, part.measures.length - step)),
    }));
  };

  const handleApplyChart = () => {
    const applyRows = () => {
      const rows = parseChartText(chartDraft, chartFormat);
      if (rows.length === 0) {
        showToast("차트 텍스트에서 마디를 찾지 못했습니다.");
        return;
      }

      const nextParts = rowsToParts(rows);
      startTransition(() => {
        setParts(nextParts);
        setChartSource("grid");
        setSelectedMeasure({ partId: nextParts[0]?.id ?? "", measureIndex: 0 });
      });
      showToast("텍스트 차트를 적용했습니다.");
    };

    if (hasAmbiguousChartText(chartDraft, chartFormat)) {
      setDialogState({
        title: "마디 구분 불명확",
        message:
          "마디 구분이 명확하지 않은 부분을 발견 하였습니다.\n(ChordWiki의 문서 작성 방식 특성상 이러한 문제가 발생할 수 있습니다.)\n결과물에 오차가 발생할 수 있습니다.",
        actions: [
          {
            label: "취소",
            variant: "ghost",
            onClick: () => setDialogState(null),
          },
          {
            label: "계속",
            variant: "primary",
            onClick: () => {
              setDialogState(null);
              applyRows();
            },
          },
        ],
      });
      return;
    }

    applyRows();
  };

  const handleChartImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    setChartSource("text");
    setChartDraft(text);
    showToast(`${file.name} 파일을 불러왔습니다.`);
    event.target.value = "";
  };

  const handleExportChart = () => {
    downloadBlob(
      new Blob([serializeChart(parts)], { type: "text/plain;charset=utf-8" }),
      "chord-chart.txt",
    );
    showToast("차트 텍스트를 저장했습니다.");
  };

  const handleApplyUpdate = useEffectEvent(async () => {
    try {
      setIsApplyingUpdate(true);
      setIsUpdateReady(false);
      await applyPwaUpdate();
    } catch (error) {
      console.error(error);
      setIsUpdateReady(true);
      setIsApplyingUpdate(false);
      showToast("업데이트 적용 중 오류가 발생했습니다.");
    }
  });

  const handleExportMidi = () => {
    try {
      const blob = exportChartToMidi(parts, settings);
      downloadBlob(blob, "chord-progression.mid");
      showToast("MIDI 파일을 저장했습니다.");
    } catch (error) {
      console.error(error);
      showToast("MIDI 생성 중 오류가 발생했습니다.");
    }
  };

  const handleClearChart = () => {
    if (!window.confirm("현재 차트를 새로 시작할까요?")) {
      return;
    }

    const nextParts = createDefaultParts();
    startTransition(() => {
      setParts(nextParts);
      setChartSource("grid");
      setSelectedMeasure({ partId: nextParts[0].id, measureIndex: 0 });
    });
  };

  const handleInsertChord = () => {
    const targetPart = selectedPart ?? parts[0];
    if (!targetPart) {
      return;
    }

    const naturalTensions = builder.tensions.filter((tension) => !/[b#]/.test(tension));
    const accidentalTensions = builder.tensions.filter((tension) => /[b#]/.test(tension));
    const qualityText =
      builder.quality === "Major" ? "" : builder.quality === "Minor" ? "m" : builder.quality;
    const tensionText = naturalTensions
      .slice()
      .sort(
        (left, right) =>
          Number.parseInt(left.replaceAll(/\D/g, ""), 10) -
          Number.parseInt(right.replaceAll(/\D/g, ""), 10),
      )
      .join("");
    const parenText = accidentalTensions.length > 0 ? `(${accidentalTensions.sort().join(",")})` : "";
    const chordToParse = `${builder.root}${qualityText}${tensionText}${parenText}`;

    try {
      const parsed = parseChordSymbol(chordToParse, selectedKey);
      const symbol = buildStringFromParsed(parsed, mode === "degree", selectedKey);
      const currentValue = targetPart.measures[selectedMeasure.measureIndex] ?? "";
      handleMeasureChange(targetPart.id, selectedMeasure.measureIndex, `${currentValue} ${symbol}`.trim());
      showToast(`${symbol} 코드를 추가했습니다.`);
    } catch (error) {
      console.error(error);
      showToast("선택한 코드 조합을 만들 수 없습니다.");
    }
  };

  const moveSelection = (direction: -1 | 1) => {
    if (!selectedPart || selectedPartIndex < 0) {
      return;
    }

    let partIndex = selectedPartIndex;
    let measureIndex = selectedMeasure.measureIndex + direction;

    if (measureIndex < 0) {
      if (partIndex === 0) {
        return;
      }
      partIndex -= 1;
      measureIndex = parts[partIndex].measures.length - 1;
    }

    if (measureIndex >= parts[partIndex].measures.length) {
      if (partIndex >= parts.length - 1) {
        return;
      }
      partIndex += 1;
      measureIndex = 0;
    }

    setSelectedMeasure({
      partId: parts[partIndex].id,
      measureIndex,
    });
  };

  const handlePreviewChord = useEffectEvent(async (row: PreviewRow) => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    if (playingPreviewId === row.id) {
      stopChordPreview();
      setPlayingPreviewId(null);
      return;
    }

    if (row.midiNotes.length === 0) {
      return;
    }

    try {
      setPlayingPreviewId(row.id);
      const durationMs = await playChordPreview(row.midiNotes, settings.previewVolume);

      previewTimerRef.current = window.setTimeout(() => {
        setPlayingPreviewId((current) => (current === row.id ? null : current));
        previewTimerRef.current = null;
      }, durationMs);
    } catch (error) {
      console.error(error);
      stopChordPreview();
      setPlayingPreviewId(null);
      showToast("오디오 프리뷰를 재생할 수 없습니다.");
    }
  });

  const handlePreviewNameClick = (row: PreviewRow) => {
    if (!settings.previewEnabled || row.midiNotes.length === 0) {
      return;
    }

    void handlePreviewChord(row);
  };

  const handleMeasureTokenHoldStart = useEffectEvent(async (row: PreviewRow) => {
    if (!settings.previewEnabled || row.midiNotes.length === 0) {
      return;
    }

    try {
      setPlayingPreviewId(row.id);
      await startHeldChordPreview(row.midiNotes, settings.previewVolume);
    } catch (error) {
      console.error(error);
      stopChordPreview();
      setPlayingPreviewId(null);
      showToast("오디오 프리뷰를 재생할 수 없습니다.");
    }
  });

  const handleMeasureTokenHoldEnd = useEffectEvent((rowId: string) => {
    stopChordPreview();
    setPlayingPreviewId((current) => (current === rowId ? null : current));
  });

  return (
    <div className="app-shell" style={{ "--manual-scale": manualScale } as CSSProperties}>
      <div className="noise-grid" />
      <div className="backdrop-orb backdrop-orb--left" />
      <div className="backdrop-orb backdrop-orb--right" />

      <header className="topbar">
        <div className="topbar__actions">
          <button className="button button--primary" onClick={handleExportMidi}>
            MIDI 저장
          </button>
          <button className="button button--ghost" onClick={handleExportChart}>
            차트 저장
          </button>
          <button className="button button--ghost" onClick={() => fileInputRef.current?.click()}>
            TXT 불러오기
          </button>
          <button className="button button--ghost" onClick={handleClearChart}>
            새 차트
          </button>
          <button className="button button--ghost" onClick={() => setIsHelpOpen(true)}>
            도움말
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".txt,text/plain"
            onChange={handleChartImport}
          />
        </div>

        <div className="topbar__zoom">
          <button
            className="button button--ghost button--small"
            onClick={() => setManualScale((current) => Math.max(0.7, Number((current - 0.05).toFixed(2))))}
            aria-label="배율 축소"
            title="배율 축소"
          >
            -
          </button>
          <button
            className="button button--ghost button--small"
            onClick={() => setManualScale(1)}
            aria-label="기본 배율"
            title="기본 배율"
          >
            {Math.round(manualScale * 100)}%
          </button>
          <button
            className="button button--ghost button--small"
            onClick={() => setManualScale((current) => Math.min(1.35, Number((current + 0.05).toFixed(2))))}
            aria-label="배율 확대"
            title="배율 확대"
          >
            +
          </button>
        </div>
      </header>

      {deferredUpdateReady ? (
        <section className="update-banner" role="status" aria-live="polite">
          <div className="update-banner__copy">
            <span className="panel__eyebrow">새 업데이트</span>
            <strong>새 버전이 준비되었습니다.</strong>
            <p>업데이트를 적용하면 현재 작업 화면이 초기화될 수 있습니다. 먼저 차트를 저장한 뒤 진행하는 것을 권장합니다.</p>
          </div>
          <div className="update-banner__actions">
            <button className="button button--ghost" onClick={handleExportChart}>
              차트 저장
            </button>
            <button
              className="button button--primary"
              onClick={() => void handleApplyUpdate()}
              disabled={isApplyingUpdate}
            >
              {isApplyingUpdate ? "업데이트 중..." : "업데이트"}
            </button>
            <button
              className="button button--ghost"
              onClick={() => setIsUpdateReady(false)}
              disabled={isApplyingUpdate}
            >
              나중에
            </button>
          </div>
        </section>
      ) : null}

      <main className="studio-layout">
        <div className="workspace-column">
          <section className="editor-panel">
            <div className="editor-toolbar">
              <div className="editor-toolbar__stack">
                <div className="editor-toolbar__main">
                  <div className="editor-toolbar__primary-controls">
                    <label className="field field--compact field--segmented">
                      <span>전환</span>
                      <div className="segmented">
                        <button
                          className={mode === "alphabet" ? "is-active" : ""}
                          onClick={() => handleModeChange("alphabet")}
                        >
                          알파벳
                        </button>
                        <button
                          className={mode === "degree" ? "is-active" : ""}
                          onClick={() => handleModeChange("degree")}
                        >
                          로마자
                        </button>
                      </div>
                    </label>

                    <label className="field field--compact field--octave">
                      <span>옥타브</span>
                      <select
                        value={settings.voicingOctaveShift}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            voicingOctaveShift: Number(event.target.value),
                          }))
                        }
                      >
                        {[2, 1, 0, -1, -2].map((shift) => (
                          <option key={shift} value={shift}>
                            {shift > 0 ? `+${shift}` : shift}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field field--compact">
                      <span>보이싱</span>
                      <select
                        value={settings.voicingStyle}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            voicingStyle: event.target.value as VoicingStyle,
                          }))
                        }
                      >
                        {VOICING_STYLES.map((style) => (
                          <option key={style} value={style}>
                            {style}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="editor-toolbar__option-toggles">
                    <label className="toggle toggle--compact">
                      <input
                        type="checkbox"
                        checked={settings.omit5OnConflict}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            omit5OnConflict: event.target.checked,
                          }))
                        }
                      />
                      <span>충돌 시 5음 생략</span>
                    </label>

                    <label className="toggle toggle--compact">
                      <input
                        type="checkbox"
                        checked={settings.omitDuplicatedBass}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            omitDuplicatedBass: event.target.checked,
                          }))
                        }
                      />
                      <span>중복 베이스 정리</span>
                    </label>
                  </div>
                </div>

                <div className="editor-toolbar__secondary">
                  <label className="field field--compact field--segmented">
                    <span>모드</span>
                    <div className="segmented editor-toolbar__mode-switch">
                      <button
                        className={!settings.previewEnabled ? "is-active" : ""}
                        onClick={() =>
                          setSettings((current) => ({
                            ...current,
                            previewEnabled: false,
                          }))
                        }
                      >
                        편집
                      </button>
                      <button
                        className={settings.previewEnabled ? "is-active" : ""}
                        onClick={() =>
                          setSettings((current) => ({
                            ...current,
                            previewEnabled: true,
                          }))
                        }
                      >
                        미리듣기
                      </button>
                    </div>
                  </label>

                  <div className="range-control field--preview-volume">
                    <span className="range-control__icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path
                          d="M5 10v4h3l4 4V6L8 10H5zm10.5 2a3.5 3.5 0 0 0-2.1-3.21v6.42A3.5 3.5 0 0 0 15.5 12zm0-7.12v2.06a6 6 0 0 1 0 10.12v2.06a8 8 0 0 0 0-14.24z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(settings.previewVolume * 100)}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          previewVolume: Number(event.target.value) / 100,
                        }))
                      }
                      aria-label="프리뷰 볼륨"
                    />
                    <strong>{Math.round(settings.previewVolume * 100)}%</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="parts-stack">
              {parts.map((part, index) => (
                <article
                  className={`part-card ${selectedPart?.id === part.id ? "part-card--active" : ""}`}
                  key={part.id}
                  style={{ zIndex: parts.length - index }}
                >
                  <div className="part-card__header">
                    <div className="part-card__meta">
                      <label className="field field--compact" style={{ position: "relative" }}>
                        <span>Key</span>
                        <KeyDropdown
                          value={part.key}
                          onChange={(newKey) => handlePartKeyChange(part.id, newKey)}
                        />
                      </label>

                      <input
                        className="part-title-input"
                        value={partNameDrafts[part.id] ?? part.part}
                        onChange={(event) => handlePartNameChange(part.id, event.target.value)}
                        onCompositionStart={() =>
                          setPartNameComposing((current) => ({
                            ...current,
                            [part.id]: true,
                          }))
                        }
                        onCompositionEnd={(event) => finishPartNameEdit(part.id, event.currentTarget.value)}
                        onBlur={(event) => finishPartNameEdit(part.id, event.target.value)}
                        placeholder="파트 이름입력"
                      />
                    </div>

                    <div className="part-card__controls">
                      <button className="button button--ghost" onClick={() => handleRemoveMeasures(part.id)}>
                        -
                      </button>
                      <input
                        className="measure-step-input"
                        type="number"
                        min={1}
                        value={measureSteps[part.id] ?? 4}
                        onChange={(event) => handleMeasureStepChange(part.id, Number(event.target.value))}
                        aria-label="마디 수 조절"
                      />
                      <button className="button button--ghost" onClick={() => handleAddMeasures(part.id)}>
                        +
                      </button>
                      <button
                        className="button button--ghost button--icon danger"
                        onClick={() => handleDeletePart(part.id)}
                        aria-label="파트 제거"
                        title="파트 제거"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 11h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="measure-grid">
                    {part.measures.map((measure, measureIndex) => {
                      const isSelected =
                        selectedMeasure.partId === part.id && selectedMeasure.measureIndex === measureIndex;
                      const measurePreviewRows = splitMeasureText(measure).map((token, tokenIndex) =>
                        buildPreviewRow(
                          parts,
                          { partId: part.id, measureIndex },
                          part.key,
                          settings,
                          mode,
                          token,
                          tokenIndex,
                        ),
                      );

                      return (
                        <label
                          key={`${part.id}-${measureIndex}`}
                          className={`measure-card ${isSelected ? "is-selected" : ""} ${
                            settings.previewEnabled ? "measure-card--preview" : ""
                          } ${
                            measure.trim().toLowerCase() === "x" ? "is-muted" : ""
                          }`}
                          onClick={() => setSelectedMeasure({ partId: part.id, measureIndex })}
                        >
                          <span className="measure-card__index">#{measureIndex + 1}</span>
                          <input
                            value={measure}
                            style={getMeasureInputFontSize(measure)}
                            placeholder={measureIndex === 0 ? "예시: CM7" : ""}
                            readOnly={settings.previewEnabled}
                            onFocus={() => setSelectedMeasure({ partId: part.id, measureIndex })}
                            onChange={(event) => handleMeasureChange(part.id, measureIndex, event.target.value)}
                          />
                          {settings.previewEnabled && measurePreviewRows.length > 0 ? (
                            <div className="measure-card__token-overlay">
                              {measurePreviewRows.map((row) => (
                                <button
                                  key={row.id}
                                  type="button"
                                  className={`measure-card__token-button ${
                                    playingPreviewId === row.id ? "is-playing" : ""
                                  }`}
                                  style={getMeasureTokenFontSize(row.label, measurePreviewRows.length)}
                                  disabled={row.midiNotes.length === 0}
                                  onPointerDown={(event) => {
                                    event.preventDefault();
                                    setSelectedMeasure({ partId: part.id, measureIndex });
                                    void handleMeasureTokenHoldStart(row);
                                  }}
                                  onPointerUp={() => handleMeasureTokenHoldEnd(row.id)}
                                  onPointerLeave={() => handleMeasureTokenHoldEnd(row.id)}
                                  onPointerCancel={() => handleMeasureTokenHoldEnd(row.id)}
                                  title={
                                    row.midiNotes.length > 0
                                      ? "누르고 있는 동안 코드 미리듣기"
                                      : "재생할 수 없는 코드"
                                  }
                                >
                                  {row.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>

                  <div className="part-card__footer">
                    <button
                      className="button button--ghost button--add-part"
                      onClick={() => handleAddPart(part.id)}
                    >
                      + 파트 추가
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel panel--selection">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Selected measure</span>
                <h2>{selectedPart?.part.trim() || "Untitled part"}</h2>
              </div>
              <span className="surface-chip">{selectedKey}</span>
            </div>

            <div className="selection-summary">
              <span className="surface-chip">
                현재 위치: {selectedPart?.part.trim() || "이름 없는 파트"} #{selectedMeasure.measureIndex + 1}
              </span>
              <span className="surface-chip">코드 수: {selectedMeasureTokens.length}</span>
            </div>

            <div className="preview-list">
              {previewRows.length === 0 ? (
                <div className="empty-state">선택된 마디에 입력된 코드가 없습니다.</div>
              ) : (
                previewRows.map((row) => (
                  <article
                    key={row.id}
                    className={`preview-card preview-card--${row.status} ${
                      playingPreviewId === row.id ? "is-playing" : ""
                    }`}
                  >
                    <div className="preview-card__header">
                      <div className="preview-card__top">
                        <button
                          type="button"
                          className={`preview-card__name-button ${
                            settings.previewEnabled && row.midiNotes.length > 0 ? "is-enabled" : ""
                          }`}
                          onClick={() => handlePreviewNameClick(row)}
                          disabled={!settings.previewEnabled || row.midiNotes.length === 0}
                          aria-label={`${row.label} 코드 이름`}
                          title={
                            settings.previewEnabled && row.midiNotes.length > 0
                              ? "코드 이름 클릭으로 미리듣기"
                              : "상단 미리듣기를 켜면 코드 이름 클릭으로 재생됩니다."
                          }
                        >
                          입력한 코드: {row.label}
                        </button>
                        <span>{row.detail}</span>
                      </div>
                      <button
                        className={`button button--ghost button--small preview-card__play-button ${
                          playingPreviewId === row.id ? "is-playing" : ""
                        }`}
                        onClick={() => handlePreviewChord(row)}
                        disabled={row.midiNotes.length === 0}
                        aria-label={`${row.label} 코드 프리뷰 ${playingPreviewId === row.id ? "정지" : "재생"}`}
                        title={row.midiNotes.length > 0 ? "피아노 프리뷰 듣기" : "재생할 수 없는 코드"}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          {playingPreviewId === row.id ? (
                            <path d="M7 6h4v12H7zM13 6h4v12h-4z" fill="currentColor" />
                          ) : (
                            <path d="M8 6v12l10-6-10-6z" fill="currentColor" />
                          )}
                        </svg>
                        {playingPreviewId === row.id ? "정지" : "듣기"}
                      </button>
                    </div>
                    {row.notes.length > 0 ? (
                      <div className="note-row">
                        {row.notes.map((note) => (
                          <span className="note-chip" key={note}>
                            {note}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="inspector">

          <section className="panel">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">코드 삽입</span>
              </div>
              <span className="surface-chip">Target: #{selectedMeasure.measureIndex + 1}</span>
            </div>

            <div className="builder-grid">
              <label className="field">
                <span>Root</span>
                <select
                  value={builder.root}
                  onChange={(event) =>
                    setBuilder((current) => ({
                      ...current,
                      root: event.target.value,
                    }))
                  }
                >
                  {builderRootOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Quality</span>
                <select
                  value={builder.quality}
                  onChange={(event) =>
                    setBuilder((current) => ({
                      ...current,
                      quality: event.target.value,
                    }))
                  }
                >
                  {QUALITY_SYMBOLS.map((quality) => (
                    <option key={quality} value={quality}>
                      {quality}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="tension-cloud">
              {TENSIONS_LIST.map((tension) => {
                const active = builder.tensions.includes(tension);
                return (
                  <button
                    key={tension}
                    className={`tension-pill ${active ? "is-active" : ""}`}
                    onClick={() =>
                      setBuilder((current) => ({
                        ...current,
                        tensions: active
                          ? current.tensions.filter((entry) => entry !== tension)
                          : [...current.tensions, tension],
                      }))
                    }
                  >
                    {tension}
                  </button>
                );
              })}
            </div>

            <div className="panel__actions">
              <button
                className="button button--ghost"
                onClick={() =>
                  setBuilder((current) => ({
                    ...current,
                    tensions: [],
                  }))
                }
              >
                텐션 초기화
              </button>
              <button className="button button--primary" onClick={handleInsertChord}>
                선택 마디에 삽입
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel__header panel__header--chart">
              <div className="chart-panel__header-main">
                <div>
                  <span className="panel__eyebrow">텍스트 차트</span>
                </div>
                <button className="button button--primary" onClick={handleApplyChart}>
                  텍스트 적용
                </button>
              </div>
              <div className="panel__actions chart-panel__controls">
                <div className="segmented" role="tablist" aria-label="텍스트 차트 포맷">
                  {CHART_FORMAT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={chartFormat === option.value ? "is-active" : ""}
                      onClick={() => {
                        if (option.value === "chordwiki" && chartFormat !== "chordwiki") {
                          setDialogState({
                            title: "ChordWiki 실험 기능",
                            message: "해당 기능은 아직 코드 해석이 불완전한 실험 단계입니다.",
                            actions: [
                              {
                                label: "확인",
                                variant: "primary",
                                onClick: () => {
                                  setDialogState(null);
                                  setChartFormat(option.value);
                                  setChartSource("grid");
                                },
                              },
                            ],
                          });
                          return;
                        }
                        setChartFormat(option.value);
                        setChartSource("grid");
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoFormatChart}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAutoFormatChart(checked);
                      if (checked) {
                        setChartDraft((current) => formatChartText(current));
                      }
                    }}
                  />
                  <span className="toggle-switch__slider"></span>
                  <span className="toggle-switch__label">자동 줄맞춤</span>
                </label>
              </div>
            </div>

            <ChartTextarea
              value={chartDraft}
              placeholder={chartFormat === "chordwiki" ? CHORDWIKI_PLACEHOLDER : CHART_PLACEHOLDER}
              onValueChange={(nextValue) => {
                setChartSource("text");
                setChartDraft(nextValue);
              }}
              onBlur={() => {
                if (autoFormatChart) {
                  setChartDraft((current) => formatChartText(current));
                }
              }}
            />
          </section>
        </aside>
      </main>

      {isHelpOpen ? (
        <div className="help-overlay" onClick={() => setIsHelpOpen(false)}>
          <div
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="help-dialog__header">
              <div>
                <span className="panel__eyebrow">도움말</span>
                <h2 id="help-title">Chord to MIDI 사용 설명서</h2>
              </div>
              <button className="button button--ghost button--small" onClick={() => setIsHelpOpen(false)}>
                닫기
              </button>
            </div>

            <div className="help-dialog__content">
              <section className="help-section">
                <h3>이 도구는 무엇인가요?</h3>
                <p>
                  <strong>입력한 코드 진행을 MIDI로 변환</strong>하고,
                  <strong> 파트 단위로 차트를 정리</strong>하고,
                  <strong> 구성음을 확인하면서 빠르게 편집</strong>할 수 있는 도구입니다.
                </p>
              </section>

              <section className="help-section">
                <h3>기본 사용법</h3>
                <ul className="help-list">
                  {HELP_BASICS.map((item) => (
                    <li key={item}>{renderHighlightedText(item)}</li>
                  ))}
                </ul>
              </section>

              <section className="help-section">
                <h3>기능 상세 설명</h3>
                <ul className="help-list">
                  {HELP_FEATURE_DETAILS.map((item) => (
                    <li key={item}>{renderHighlightedText(item)}</li>
                  ))}
                </ul>
              </section>

              <section className="help-section">
                <h3>텍스트 차트 파일(.txt) 규칙</h3>
                <p>
                  {renderHighlightedText(
  "저장된 텍스트 차트는 `TXT 불러오기` 또는 `텍스트 차트` 패널에서 다시 가져올 수 있습니다.",
                  )}
                </p>
                <ul className="help-list">
                  {HELP_TEXT_RULES.map((item) => (
                    <li key={item}>{renderHighlightedText(item)}</li>
                  ))}
                </ul>
              </section>

              <section className="help-section">
                <h3>예시 코드</h3>
                <pre className="help-example">
                  <code>{HELP_CHART_EXAMPLE}</code>
                </pre>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {dialogState ? (
        <div className="help-overlay" onClick={() => setDialogState(null)}>
          <div
            className="help-dialog help-dialog--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="help-dialog__header">
              <div>
                <span className="panel__eyebrow">안내</span>
                <h2 id="app-dialog-title">{dialogState.title}</h2>
              </div>
            </div>
            <div className="help-dialog__content">
              <p className="dialog-message">{dialogState.message}</p>
            </div>
            <div className="dialog-actions">
              {dialogState.actions.map((action) => (
                <button
                  key={action.label}
                  className={action.variant === "primary" ? "button button--primary" : "button button--ghost"}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="app-version" aria-label="앱 버전">
        © TSK · v1.1.0
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

export default App;
