import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface UIStateContextValue {
  mobileSidebarOpen: boolean;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
}

const UIStateContext = createContext<UIStateContextValue>({
  mobileSidebarOpen: false,
  toggleMobileSidebar: () => {},
  closeMobileSidebar: () => {},
});

export function UIStateProvider({ children }: { children: ReactNode }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const toggleMobileSidebar = useCallback(() => setMobileSidebarOpen((o) => !o), []);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  return (
    <UIStateContext.Provider value={{ mobileSidebarOpen, toggleMobileSidebar, closeMobileSidebar }}>
      {children}
    </UIStateContext.Provider>
  );
}

export function useUIState() {
  return useContext(UIStateContext);
}
