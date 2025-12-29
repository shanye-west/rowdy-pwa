import { createContext, useCallback, useContext, useState } from "react";

type LayoutConfig = {
  title: string;
  series?: string;
  showBack?: boolean;
  tournamentLogo?: string;
};

type LayoutContextValue = {
  config: LayoutConfig;
  setConfig: (config: LayoutConfig) => void;
};

const defaultConfig: LayoutConfig = {
  title: "Rowdy Cup",
  showBack: false,
};

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<LayoutConfig>(defaultConfig);

  const setConfig = useCallback((next: LayoutConfig) => {
    setConfigState((prev) => {
      if (
        prev.title === next.title &&
        prev.series === next.series &&
        prev.showBack === next.showBack &&
        prev.tournamentLogo === next.tournamentLogo
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  return (
    <LayoutContext.Provider value={{ config, setConfig }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error("useLayout must be used within a LayoutProvider");
  }
  return context;
}

export type { LayoutConfig };
