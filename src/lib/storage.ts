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
