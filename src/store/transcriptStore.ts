/**
 * Transcript Store
 *
 * Provides reactive access to project transcripts with full history-integrated
 * mutations (UpdateTranscriptWordCommand).
 */

import { create } from "zustand";
import type { Transcript, TranscriptWord } from "@/types/captions";
import { useTimelineStore } from "./timelineStore";
import { useHistoryStore } from "./historyStore";
import { UpdateTranscriptWordCommand } from "@/core/history/commands/CaptionCommands";

interface TranscriptStore {
  activeTranscriptId: string | null;

  // Actions
  setActiveTranscriptId: (id: string | null) => void;
  setTranscript: (transcript: Transcript) => void;
  removeTranscript: (id: string) => void;

  // History-backed word editing
  updateWordText: (transcriptId: string, wordId: string, newText: string) => void;

  // Accessors
  getTranscript: (id: string) => Transcript | undefined;
  getActiveTranscript: () => Transcript | undefined;
}

export const useTranscriptStore = create<TranscriptStore>((set, get) => ({
  activeTranscriptId: null,

  setActiveTranscriptId: (id) => {
    set({ activeTranscriptId: id });
    useTimelineStore.getState().setActiveTranscriptId(id);
  },

  setTranscript: (transcript) => {
    const timeline = useTimelineStore.getState();
    const transcripts = {
      ...timeline.transcripts,
      [transcript.id]: transcript,
    };
    timeline.setTranscripts(transcripts);
    if (!get().activeTranscriptId) {
      get().setActiveTranscriptId(transcript.id);
    }
  },

  removeTranscript: (id) => {
    const timeline = useTimelineStore.getState();
    const transcripts = { ...timeline.transcripts };
    delete transcripts[id];
    timeline.setTranscripts(transcripts);
    if (get().activeTranscriptId === id) {
      const remainingIds = Object.keys(transcripts);
      get().setActiveTranscriptId(remainingIds.length > 0 ? remainingIds[0] : null);
    }
  },

  updateWordText: (transcriptId, wordId, newText) => {
    const timeline = useTimelineStore.getState();
    const transcript = timeline.transcripts[transcriptId];
    if (!transcript) return;

    const currentWord = transcript.words.find((w: TranscriptWord) => w.id === wordId);
    if (!currentWord || currentWord.text === newText) return;

    const command = new UpdateTranscriptWordCommand(
      transcriptId,
      wordId,
      newText,
      currentWord.text,
    );

    useHistoryStore.getState().execute(command);
  },

  getTranscript: (id) => {
    return useTimelineStore.getState().transcripts[id];
  },

  getActiveTranscript: () => {
    const { activeTranscriptId } = get();
    if (!activeTranscriptId) return undefined;
    return useTimelineStore.getState().transcripts[activeTranscriptId];
  },
}));
