import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const AUTH_STORAGE_KEY = 'auth-storage';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'faculty' | 'admin';
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: (user, token) => {
        set({ user, token, isAuthenticated: true });
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    { name: AUTH_STORAGE_KEY }
  )
);

function readPersistedAuth(): Pick<AuthState, 'user' | 'token' | 'isAuthenticated'> | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return { user: null, token: null, isAuthenticated: false };
    }
    const parsed = JSON.parse(raw) as { state?: Partial<AuthState> };
    const s = parsed.state;
    if (s?.token && s?.user) {
      return { user: s.user as User, token: s.token as string, isAuthenticated: true };
    }
    return { user: null, token: null, isAuthenticated: false };
  } catch {
    return null;
  }
}

function syncAuthFromLocalStorage() {
  const next = readPersistedAuth();
  if (!next) return;
  const cur = useAuthStore.getState();
  if (cur.token === next.token && cur.user?.id === next.user?.id) return;
  useAuthStore.setState({
    user: next.user,
    token: next.token,
    isAuthenticated: next.isAuthenticated,
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === AUTH_STORAGE_KEY) {
      syncAuthFromLocalStorage();
    }
  });
  window.addEventListener('focus', () => {
    syncAuthFromLocalStorage();
  });
}
