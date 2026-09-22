import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'hit_auth_token';

// Secure token storage for mobile.
// Web (Next.js) uses httpOnly cookies; mobile uses SecureStore + Authorization header.
export const tokenStorage = {
  async get(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch {
      // ignore
    }
  },
  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // ignore
    }
  },
};

import AsyncStorage from '@react-native-async-storage/async-storage';

const POST_DRAFT_KEY = 'hit_ai_post_draft';   // the current in-progress draft
const POSTED_LIST_KEY = 'hit_ai_posted_list'; // all properties the user has posted

// Persists the last property the user described to AI Assist (their "Post"
// draft), so it survives AI session resets and app restarts. This is UI-only
// convenience state — the source of truth for posted listings is the backend.
export const postDraftStorage = {
  async get(): Promise<any | null> {
    try {
      const raw = await AsyncStorage.getItem(POST_DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async set(draft: any): Promise<void> {
    try {
      await AsyncStorage.setItem(POST_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }
  },
  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(POST_DRAFT_KEY);
    } catch {
      // ignore
    }
  },
};

// Persists the list of ALL properties the user has posted via AI Assist, so the
// "Post" button can show every posted property (not just the latest).
export const postedListStorage = {
  async getAll(): Promise<any[]> {
    try {
      const raw = await AsyncStorage.getItem(POSTED_LIST_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  },
  async add(item: any): Promise<any[]> {
    try {
      const list = await this.getAll();
      const withId = { ...item, id: item.id || `post_${Date.now()}`, postedAt: Date.now() };
      // De-dupe: if this property is already in the list (same projectId, or same
      // local id), update it in place (refresh postedAt) instead of adding a
      // duplicate card. Re-posting should reset the cooldown, not create a copy.
      const matches = (x: any) =>
        (withId.projectId && x.projectId && x.projectId === withId.projectId) ||
        (x.id && x.id === withId.id);
      const rest = list.filter((x: any) => !matches(x));
      const next = [withId, ...rest];
      await AsyncStorage.setItem(POSTED_LIST_KEY, JSON.stringify(next));
      return next;
    } catch {
      return [];
    }
  },
  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(POSTED_LIST_KEY);
    } catch {
      // ignore
    }
  },
};


const DISAPPEAR_KEY = 'hit_ai_disappear_ms';

// WhatsApp-style disappearing messages setting for the AI Assist chat.
// Stored as a duration in milliseconds; 0 = Never.
export const disappearStorage = {
  async get(): Promise<number> {
    try {
      const raw = await AsyncStorage.getItem(DISAPPEAR_KEY);
      const n = raw ? Number(raw) : 0;
      return isNaN(n) ? 0 : n;
    } catch {
      return 0;
    }
  },
  async set(ms: number): Promise<void> {
    try {
      await AsyncStorage.setItem(DISAPPEAR_KEY, String(ms));
    } catch {
      // ignore
    }
  },
};


const CHAT_CLEARED_BEFORE_ID_KEY = 'hit_ai_chat_cleared_before_id';

// Watermark for the AI Assist transcript: the _id of the last message that
// existed when the user explicitly ended/exited the chat. On open, everything
// up to and including this id is dropped, so "start again" is genuinely fresh —
// while a normal app reopen (which does not move the watermark) still restores
// the conversation.
//
// An id is used rather than a timestamp on purpose: message createdAt comes
// from the server while the reset happens on the device, so any clock skew
// between them could otherwise hide the brand-new question.
export const chatClearedBeforeIdStorage = {
  async get(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(CHAT_CLEARED_BEFORE_ID_KEY);
    } catch {
      return null;
    }
  },
  async set(messageId: string): Promise<void> {
    try {
      await AsyncStorage.setItem(CHAT_CLEARED_BEFORE_ID_KEY, messageId);
    } catch {
      // ignore
    }
  },
  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(CHAT_CLEARED_BEFORE_ID_KEY);
    } catch {
      // ignore
    }
  },
};
