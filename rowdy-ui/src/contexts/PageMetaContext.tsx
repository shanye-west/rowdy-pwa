import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";

export type PageMeta = {
  title?: string;
  series?: string;
  showBack?: boolean;
  tournamentLogo?: string;
};

type PageMetaContextValue = {
  meta: PageMeta;
  setMeta: (meta: PageMeta) => void;
};

const PageMetaContext = createContext<PageMetaContextValue | undefined>(undefined);

const defaultMeta: PageMeta = {
  title: "Rowdy Cup",
  showBack: false,
};

const isMetaEqual = (a: PageMeta, b: PageMeta) =>
  a.title === b.title &&
  a.series === b.series &&
  a.showBack === b.showBack &&
  a.tournamentLogo === b.tournamentLogo;

const mergeMeta = (prev: PageMeta, next: PageMeta) => {
  const merged = { ...prev } as PageMeta;
  const target = merged as Record<keyof PageMeta, PageMeta[keyof PageMeta]>;
  (Object.keys(next) as Array<keyof PageMeta>).forEach((key) => {
    const value = next[key];
    if (value !== undefined) {
      target[key] = value;
    }
  });
  return merged;
};

export function PageMetaProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMetaState] = useState<PageMeta>(defaultMeta);

  const setMeta = useCallback((next: PageMeta) => {
    setMetaState((prev) => {
      const merged = mergeMeta(prev, next);
      return isMetaEqual(prev, merged) ? prev : merged;
    });
  }, []);

  const value = useMemo(() => ({ meta, setMeta }), [meta, setMeta]);

  return <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>;
}

export function usePageMeta(meta: PageMeta) {
  const ctx = useContext(PageMetaContext);
  if (!ctx) {
    throw new Error("usePageMeta must be used within a PageMetaProvider");
  }

  useLayoutEffect(() => {
    ctx.setMeta(meta);
  }, [ctx, meta.title, meta.series, meta.showBack, meta.tournamentLogo]);
}

export function usePageMetaContext() {
  const ctx = useContext(PageMetaContext);
  if (!ctx) {
    throw new Error("usePageMetaContext must be used within a PageMetaProvider");
  }
  return ctx;
}
