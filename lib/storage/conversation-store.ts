import { STORAGE_KEYS } from "@/lib/config";
import { conversationSchema } from "@/lib/validation";
import type { Conversation } from "@/types";

export interface ConversationStore {
  load(): Conversation[];
  save(conversations: Conversation[]): void;
  clear(): void;
}

/**
 * Local-development persistence backed by window.localStorage.
 *
 * This is per-browser storage, not cross-device synchronization. A shared
 * server-side store would replace this implementation behind the same interface
 * when a database is configured.
 */
export class LocalStorageConversationStore implements ConversationStore {
  constructor(private readonly key: string = STORAGE_KEYS.conversations) {}

  load(): Conversation[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const conversations: Conversation[] = [];
      for (const entry of parsed) {
        const result = conversationSchema.safeParse(entry);
        if (result.success) conversations.push(result.data);
      }
      return conversations;
    } catch {
      return [];
    }
  }

  save(conversations: Conversation[]): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(this.key, JSON.stringify(conversations));
    } catch {
      // Quota or privacy mode failures are non-fatal; the session stays in memory.
    }
  }

  clear(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      // ignore
    }
  }
}

export const conversationStore: ConversationStore = new LocalStorageConversationStore();
