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

  /**
   * Whether the onboarding gate is being shown.
   *
   * It lives here rather than inside the gate because two different things
   * open it: arriving with a step unmet, and being turned away from a table.
   * The second is the reason it is dismissible at all — a player who closes
   * it to look around has to be able to summon it back by trying to sit down.
   */
  gateOpen: boolean;
  /** Dismissed by hand this session. Reset by any attempt to sit down. */
  gateDismissed: boolean;
  openGate: () => void;
  dismissGate: () => void;
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

  gateOpen: false,
  gateDismissed: false,
  // Opening clears the dismissal: the player asked for it back.
  openGate: () => set({ gateOpen: true, gateDismissed: false }),
  dismissGate: () => set({ gateOpen: false, gateDismissed: true }),
}));

export const toast = (message: string, tone: Tone = "info") =>
  useUiStore.getState().toast(message, tone);
