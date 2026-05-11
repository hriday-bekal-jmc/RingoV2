import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface SidebarContextType {
  /** Desktop: sidebar collapsed to icon-only rail. Persisted in localStorage. */
  collapsed: boolean;
  toggle: () => void;
  /**
   * Mobile (< md breakpoint): drawer is open. Off by default; toggled by the
   * hamburger button in Header. Auto-closes on route change.
   */
  mobileOpen: boolean;
  openMobile:  () => void;
  closeMobile: () => void;
}

const SidebarContext = createContext<SidebarContextType | null>(null);
const STORAGE_KEY = 'ringo_sidebar_collapsed';

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const openMobile  = useCallback(() => setMobileOpen(true),  []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, mobileOpen, openMobile, closeMobile }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextType {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
