import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { hasNavigationOverlay } from "../navigationOverlays";
import { clampSwipeDistance, isSwipeBackStart, shouldCompleteSwipe, SWIPE_BACK_TRANSITION_MS, swipeBackIntent } from "../swipeBack";

export type SwipeBackState = {
  isTracking: boolean;
  isDragging: boolean;
};

type Gesture = { touchId: number; startX: number; startY: number; lastX: number; lastAt: number; velocity: number; width: number; dragging: boolean; rejected: boolean };

const BLOCKED_SELECTOR = [
  "[data-disable-swipe-back]",
  "[role='dialog']",
  "[role='slider']",
  "input",
  "button",
  "a",
  "[role='button']",
  "textarea",
  "select",
  "canvas",
  "[data-map]",
  "[data-carousel]",
  "[data-swipeable]",
  ".ios-sheet",
  ".lg-slider",
  "[contenteditable='true']",
  "[data-horizontal-drag]",
].join(",");

export function swipeBackTargetIsBlocked(target: EventTarget | null, boundary: HTMLElement | null) {
  if (!(target instanceof Element) || target.closest(BLOCKED_SELECTOR)) return true;
  let element: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
  while (element && element !== boundary) {
    const style = window.getComputedStyle(element);
    if ((style.overflowX === "auto" || style.overflowX === "scroll") && element.scrollWidth > element.clientWidth + 1) return true;
    element = element.parentElement;
  }
  return false;
}

export function useSwipeBack({ canGoBack, onBack, pageRef, underlayRef, underlayContentRef, underlayScrollY, dimRef }: {
  canGoBack: boolean;
  onBack: () => boolean;
  pageRef: RefObject<HTMLDivElement | null>;
  underlayRef: RefObject<HTMLDivElement | null>;
  underlayContentRef: RefObject<HTMLDivElement | null>;
  underlayScrollY: number;
  dimRef: RefObject<HTMLSpanElement | null>;
}) {
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const transitioningRef = useRef(false);
  const [state, setState] = useState<SwipeBackState>({ isTracking: false, isDragging: false });

  function applyPosition(x: number, width: number, onApplied?: () => void) {
    const progress = Math.max(0, Math.min(1, x / Math.max(1, width)));
    const parallax = width * .3;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (pageRef.current && !reduced) pageRef.current.style.transform = `translate3d(${x}px,0,0)`;
      if (underlayRef.current && !reduced) underlayRef.current.style.transform = `translate3d(${(-parallax * (1 - progress)).toFixed(2)}px,0,0)`;
      if (dimRef.current) dimRef.current.style.opacity = String(.12 * (1 - progress));
      onApplied?.();
    });
  }

  function resetStyles(updateState = true) {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    for (const element of [pageRef.current, underlayRef.current]) {
      element?.style.removeProperty("transition");
      element?.style.removeProperty("transform");
    }
    underlayContentRef.current?.style.removeProperty("transform");
    dimRef.current?.style.removeProperty("opacity");
    if (updateState) setState({ isTracking: false, isDragging: false });
  }

  function transitionTo(x: number, width: number, onSettled: () => void) {
    const page = pageRef.current;
    const underlay = underlayRef.current;
    if (!page || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onSettled();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      page.removeEventListener("transitionend", handleTransitionEnd);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      onSettled();
    };
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === page && event.propertyName === "transform") finish();
    };
    page.addEventListener("transitionend", handleTransitionEnd);
    page.style.transition = `transform ${SWIPE_BACK_TRANSITION_MS}ms cubic-bezier(.32,.72,0,1)`;
    if (underlay) underlay.style.transition = `transform ${SWIPE_BACK_TRANSITION_MS}ms cubic-bezier(.32,.72,0,1)`;
    applyPosition(x, width, () => {
      timerRef.current = window.setTimeout(finish, SWIPE_BACK_TRANSITION_MS + 80);
    });
  }

  function animateBack(width: number) {
    setState({ isTracking: true, isDragging: false });
    transitionTo(0, width, resetStyles);
  }

  function completeBack(width: number) {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    setState({ isTracking: true, isDragging: false });
    transitionTo(width, width, () => {
      const navigated = onBack();
      transitioningRef.current = false;
      if (!navigated) {
        resetStyles();
        return;
      }
      // Keep the completed page translated offscreen until React commits the
      // navigation and removes it. Clearing the transform here can expose the
      // outgoing page for one frame after the swipe finishes.
      setState({ isTracking: false, isDragging: false });
    });
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const boundary = pageRef.current;
    if (!boundary) return;
    const bounds = boundary.getBoundingClientRect();
    const localX = touch.clientX - bounds.left;
    if (!canGoBack
      || transitioningRef.current
      || hasNavigationOverlay()
      || !isSwipeBackStart(localX, bounds.width)
      || swipeBackTargetIsBlocked(event.target, boundary)) return;
    // The pushed page and its root page share the window scroll container.
    // Offset the root underlay so the interactive reveal starts at its saved
    // position instead of briefly exposing the top of Home.
    if (underlayContentRef.current) {
      const offsetY = window.scrollY - underlayScrollY;
      underlayContentRef.current.style.transform = `translate3d(0,${offsetY}px,0)`;
    }
    // Claim the gesture before Safari can begin its browser-history snapshot.
    event.preventDefault();
    gestureRef.current = { touchId: touch.identifier, startX: touch.clientX, startY: touch.clientY, lastX: touch.clientX, lastAt: performance.now(), velocity: 0, width: bounds.width, dragging: false, rejected: false };
    setState({ isTracking: true, isDragging: false });
  }

  function onTouchMove(event: TouchEvent) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.rejected) return;
    const touch = Array.from(event.touches).find((candidate) => candidate.identifier === gesture.touchId);
    if (!touch) return;
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    if (!gesture.dragging) {
      const intent = swipeBackIntent(dx, dy);
      if (intent === "pending") return;
      if (intent === "rejected") {
        gesture.rejected = true;
        return;
      }
      gesture.dragging = true;
      setState({ isTracking: true, isDragging: true });
    }
    event.preventDefault();
    const now = performance.now();
    gesture.velocity = Math.max(0, touch.clientX - gesture.lastX) / Math.max(1, now - gesture.lastAt);
    gesture.lastX = touch.clientX;
    gesture.lastAt = now;
    applyPosition(clampSwipeDistance(dx, gesture.width), gesture.width);
  }

  function finish(cancelled = false) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    if (cancelled || gesture.rejected || !gesture.dragging) {
      animateBack(gesture.width);
      return;
    }
    const distance = clampSwipeDistance(gesture.lastX - gesture.startX, gesture.width);
    if (shouldCompleteSwipe(distance, gesture.width, gesture.velocity)) completeBack(gesture.width);
    else animateBack(gesture.width);
  }

  useEffect(() => {
    const cancel = () => {
      gestureRef.current = null;
      transitioningRef.current = false;
      resetStyles(false);
    };
    const page = pageRef.current;
    const touchEnd = () => finish();
    const touchCancel = () => finish(true);
    if (canGoBack && page) {
      page.addEventListener("touchstart", onTouchStart, { passive: false });
      page.addEventListener("touchmove", onTouchMove, { passive: false });
      page.addEventListener("touchend", touchEnd, { passive: true });
      page.addEventListener("touchcancel", touchCancel, { passive: true });
    }
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("resize", cancel);
      page?.removeEventListener("touchstart", onTouchStart);
      page?.removeEventListener("touchmove", onTouchMove);
      page?.removeEventListener("touchend", touchEnd);
      page?.removeEventListener("touchcancel", touchCancel);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      resetStyles(false);
    };
  }, [canGoBack]);

  return {
    state,
  };
}

export function SwipeBackContainer({ canGoBack, onBack, underlayScrollY = 0, page, children }: { canGoBack: boolean; onBack: () => boolean; underlayScrollY?: number; page?: ReactNode; children: ReactNode }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const underlayRef = useRef<HTMLDivElement>(null);
  const underlayContentRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLSpanElement>(null);
  const leadingGuardRef = useRef<HTMLSpanElement>(null);
  const trailingGuardRef = useRef<HTMLSpanElement>(null);
  const { state } = useSwipeBack({ canGoBack, onBack, pageRef, underlayRef, underlayContentRef, underlayScrollY, dimRef });
  useEffect(() => {
    if (canGoBack) return;
    const preventNativeHistory = (event: TouchEvent) => event.preventDefault();
    const guards = [leadingGuardRef.current, trailingGuardRef.current];
    guards.forEach((guard) => guard?.addEventListener("touchstart", preventNativeHistory, { passive: false }));
    return () => guards.forEach((guard) => guard?.removeEventListener("touchstart", preventNativeHistory));
  }, [canGoBack]);
  return <div className={`swipe-back-stage${state.isTracking ? " is-tracking" : ""}${state.isDragging ? " is-dragging" : ""}`}>
    {!canGoBack && <>
      <span ref={leadingGuardRef} className="native-history-guard native-history-guard--leading" aria-hidden="true" />
      <span ref={trailingGuardRef} className="native-history-guard native-history-guard--trailing" aria-hidden="true" />
    </>}
    <div ref={underlayRef} className={canGoBack ? "swipe-back-underlay" : "swipe-back-base"} aria-hidden={canGoBack || undefined} inert={canGoBack || undefined}>
      <div ref={underlayContentRef} className="swipe-back-underlay-content" style={canGoBack ? undefined : { transform: "none" }}>{children}</div>
      {canGoBack && <span ref={dimRef} className="swipe-back-dim" />}
    </div>
    {canGoBack && <div ref={pageRef} className="swipe-back-page">{page}</div>}
  </div>;
}
