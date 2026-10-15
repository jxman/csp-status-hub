import { useEffect, useState } from 'react';

// 'terminal' is an opt-in look (green-on-black, monospace). It's never the
// default — first-time visitors still get 'system'.
export type ThemeMode = 'light' | 'dark' | 'system' | 'terminal';
type ResolvedTheme = 'light' | 'dark' | 'terminal';

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem('csp-theme');
  if (stored === 'light' || stored === 'dark' || stored === 'system' || stored === 'terminal') return stored;
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    const root = document.documentElement;
    // Terminal builds on dark: it keeps the `dark` class (Tailwind dark:
    // variants, dark logo) and layers `theme-terminal` token overrides on top.
    const isDark = resolvedTheme === 'dark' || resolvedTheme === 'terminal';
    root.classList.toggle('dark', isDark);
    root.classList.toggle('theme-dark', isDark);
    root.classList.toggle('theme-terminal', resolvedTheme === 'terminal');
  }, [resolvedTheme]);

  useEffect(() => {
    localStorage.setItem('csp-theme', mode);
  }, [mode]);

  return { mode, resolvedTheme, setMode };
}
