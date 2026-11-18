import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceDetails } from "./components/EvidenceViewer";
import type { TabId } from "./components/TabBar";
import { closeTopNavigationOverlay } from "./navigationOverlays";

export type NavigationPage =
  | { id: "history"; scrollY: number }
  | { id: "evidence"; evidence: EvidenceDetails; scrollY: number };
export type NavigationDestination =
  | { id: "history" }
  | { id: "evidence"; evidence: EvidenceDetails };

type AppHistoryState = { __billForUs: true; session: string; depth: number; tab: TabId; version: 2 };

function focusActiveHeading() {
  window.requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>(".swipe-back-page h1, main h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
}

export function useNavigationHistory(initialTab: TabId = "home") {
  const [tab, setTabState] = useState<TabId>(initialTab);
  const [pages, setPages] = useState<NavigationPage[]>([]);
  const tabRef = useRef(tab);
  const pagesRef = useRef(pages);
  const sessionRef = useRef("");
  const tabScrollRef = useRef(new Map<TabId, number>());
  const backPendingRef = useRef(false);
  const pendingTabRef = useRef<TabId | null>(null);
  tabRef.current = tab;
  pagesRef.current = pages;

  const marker = useCallback((depth: number, nextTab = tabRef.current): AppHistoryState => ({
    __billForUs: true,
    session: sessionRef.current,
    depth,
    tab: nextTab,
    version: 2,
  }), []);

  useEffect(() => {
    const existing = window.history.state as Partial<AppHistoryState> | null;
    if (existing?.__billForUs && existing.session && existing.version === 2) {
      sessionRef.current = existing.session;
    } else {
      sessionRef.current = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      // Keep every top-level tab in the launch entry. Pushed pages add history;
      // roots do not, so Safari has no in-app page to swipe through on Home,
      // Receipts, Spending, or Settings.
      window.history.replaceState(marker(0, initialTab), "", window.location.href);
    }

    const onPopState = () => {
      backPendingRef.current = false;
      const currentPages = pagesRef.current;
      if (closeTopNavigationOverlay()) {
        window.history.pushState(marker(currentPages.length), "", window.location.href);
        return;
      }
      if (currentPages.length) {
        const leaving = currentPages[currentPages.length - 1];
        const nextPages = currentPages.slice(0, -1);
        pagesRef.current = nextPages;
        setPages(nextPages);
        const pendingTab = pendingTabRef.current;
        if (!nextPages.length && pendingTab) {
          pendingTabRef.current = null;
          tabRef.current = pendingTab;
          setTabState(pendingTab);
          window.history.replaceState(marker(0, pendingTab), "", window.location.href);
          window.requestAnimationFrame(() => window.scrollTo({ top: tabScrollRef.current.get(pendingTab) || 0, behavior: "instant" }));
          focusActiveHeading();
          return;
        }
        window.requestAnimationFrame(() => window.scrollTo({ top: leaving.scrollY, behavior: "instant" }));
        focusActiveHeading();
        return;
      }

      const entry = window.history.state as Partial<AppHistoryState> | null;
      if (entry?.__billForUs && entry.session === sessionRef.current && (entry.depth || 0) > 0) {
        // A browser Forward action can expose an already-closed pushed page.
        // Return to its root entry without reconstructing stale page content.
        window.history.back();
        return;
      }

      const fallbackTab: TabId = "home";
      tabRef.current = fallbackTab;
      setTabState(fallbackTab);
      window.history.replaceState(marker(0, fallbackTab), "", window.location.href);
      window.requestAnimationFrame(() => window.scrollTo({ top: tabScrollRef.current.get(fallbackTab) || 0, behavior: "instant" }));
      focusActiveHeading();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialTab, marker]);

  const pushPage = useCallback((page: NavigationDestination) => {
    const nextPage = { ...page, scrollY: window.scrollY } as NavigationPage;
    const nextPages = [...pagesRef.current, nextPage];
    pagesRef.current = nextPages;
    setPages(nextPages);
    window.history.pushState(marker(nextPages.length), "", window.location.href);
    window.scrollTo({ top: 0, behavior: "instant" });
    focusActiveHeading();
  }, [marker]);

  const goBack = useCallback(() => {
    if (backPendingRef.current) return false;
    if (closeTopNavigationOverlay()) return true;
    if (!pagesRef.current.length) return false;
    backPendingRef.current = true;
    window.history.back();
    window.setTimeout(() => { backPendingRef.current = false; }, 500);
    return true;
  }, []);

  const selectTab = useCallback((nextTab: TabId) => {
    if (closeTopNavigationOverlay()) return;
    if (pagesRef.current.length) {
      const rootScrollY = pagesRef.current[0]?.scrollY || 0;
      tabScrollRef.current.set(tabRef.current, rootScrollY);
      pendingTabRef.current = nextTab;
      if (!backPendingRef.current) {
        backPendingRef.current = true;
        window.history.back();
      }
      return;
    }
    if (!pagesRef.current.length) tabScrollRef.current.set(tabRef.current, window.scrollY);
    pagesRef.current = [];
    setPages([]);
    tabRef.current = nextTab;
    setTabState(nextTab);
    window.history.replaceState(marker(0, nextTab), "", window.location.href);
    window.requestAnimationFrame(() => window.scrollTo({ top: tabScrollRef.current.get(nextTab) || 0, behavior: "instant" }));
    focusActiveHeading();
  }, [marker]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (goBack()) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goBack]);

  return {
    tab,
    pages,
    activePage: pages[pages.length - 1] || null,
    canGoBack: pages.length > 0,
    pushPage,
    goBack,
    selectTab,
  };
}
