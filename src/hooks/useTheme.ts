import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function getInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('csp-theme') as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitial);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('csp-theme', theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggle };
}
