import { create } from "zustand";

export type Tone = "info" | "good" | "bad";

export interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

interface UiState {
  toasts: Toast[];
  toast: (message: string, tone?: Tone, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],

  toast: (message, tone = "info", ttlMs = 4200) => {
    const id = nextId++;
    // Repeating the same message is noise, not emphasis.
    if (get().toasts.some((t) => t.message === message)) return;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }].slice(-4) }));
    setTimeout(() => get().dismiss(id), ttlMs);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, tone: Tone = "info") =>
  useUiStore.getState().toast(message, tone);
