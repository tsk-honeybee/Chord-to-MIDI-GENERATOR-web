import { Midi } from "@tonejs/midi";
import type { ChartPart } from "./chart";
import {
  buildVoicing,
  durationTicksForN,
  isRestToken,
  parseChordSymbol,
  splitMeasureText,
  type VoicingStyle,
} from "./chord";

export interface MidiExportSettings {
  omit5OnConflict: boolean;
  omitDuplicatedBass: boolean;
  voicingStyle: VoicingStyle;
  voicingOctaveShift: number;
}

export function exportChartToMidi(parts: ChartPart[], settings: MidiExportSettings): Blob {
  const midi = new Midi();
  midi.header.tempos.push({ bpm: 120, ticks: 0 });

  const firstKey = parts[0]?.key;
  if (firstKey && !["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"].includes(firstKey)) {
    // Skip unsupported key signatures for the MIDI header.
  } else if (firstKey) {
    midi.header.keySignatures.push({ key: firstKey, scale: "major", ticks: 0 });
  }

  const track = midi.addTrack();
  track.name = "Chord Progression";

  let currentTick = 0;
  let lastResolvedChord: string | null = null;

  parts.forEach((part) => {
    part.measures.forEach((measure) => {
      const text = measure.trim();
      if (isRestToken(text)) {
        currentTick += 4 * midi.header.ppq;
        return;
      }

      if (!text) {
        currentTick += 4 * midi.header.ppq;
        return;
      }

      const chordTokens = splitMeasureText(text);
      if (chordTokens.length === 0) {
        currentTick += 4 * midi.header.ppq;
        return;
      }

      const durations = durationTicksForN(chordTokens.length, midi.header.ppq);

      chordTokens.forEach((token, index) => {
        const resolved = token === "%" ? lastResolvedChord : token;
        if (!resolved) {
          currentTick += durations[index];
          return;
        }

        if (isRestToken(resolved)) {
          currentTick += durations[index];
          return;
        }

        try {
          const parsed = parseChordSymbol(resolved, part.key);
          const notes = buildVoicing(parsed, {
            ...settings,
          });
          const exportedNotes = notes.map((midiNote) => midiNote + 12);

          exportedNotes.forEach((midiNote) => {
            track.addNote({
              midi: midiNote,
              ticks: currentTick,
              durationTicks: durations[index],
              velocity: 0.8,
            });
          });

          lastResolvedChord = resolved;
        } catch (error) {
          console.warn(`Skipping unrecognized chord symbol '${resolved}' in MIDI export.`, {
            error,
            part: part.part,
            key: part.key,
            measure: text,
            token,
          });
        }

        currentTick += durations[index];
      });
    });
  });

  return new Blob([Uint8Array.from(midi.toArray())], { type: "audio/midi" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
