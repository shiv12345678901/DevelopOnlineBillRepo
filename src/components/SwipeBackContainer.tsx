import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { hasNavigationOverlay } from "../navigationOverlays";
import { clampSwipeDistance, isSwipeBackStart, shouldCompleteSwipe, SWIPE_BACK_TRANSITION_MS, swipeBackIntent } from "../swipeBack";

export type SwipeBackState = {
  isTracking: boolean;
  isDragging: boolean;
  progress: number;
  translateX: number;
  canGoBack: boolean;
};

type Gesture = { pointerId: number; startX: number; startY: number; lastX: number; lastAt: number; velocity: number; width: number; dragging: boolean; rejected: boolean };

const BLOCKED_SELECTOR = [
  "[data-disable-swipe-back]",
  "[role='dialog']",
  "[role='slider']",
  "input",
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

export function useSwipeBack({ canGoBack, onBack, pageRef, underlayRef, dimRef }: {
  canGoBack: boolean;
  onBack: () => boolean;
  pageRef: RefObject<HTMLDivElement | null>;
  underlayRef: RefObject<HTMLDivElement | null>;
  dimRef: RefObject<HTMLSpanElement | null>;
}) {
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const transitioningRef = useRef(false);
  const [state, setState] = useState<SwipeBackState>({ isTracking: false, isDragging: false, progress: 0, translateX: 0, canGoBack });

  function applyPosition(x: number, width: number, dragging: boolean) {
    const progress = Math.max(0, Math.min(1, x / Math.max(1, width)));
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (pageRef.current && !reduced) pageRef.current.style.transform = `translate3d(${x}px,0,0)`;
      if (underlayRef.current && !reduced) underlayRef.current.style.transform = `translate3d(${(-18 + progress * 18).toFixed(2)}px,0,0)`;
      if (dimRef.current) dimRef.current.style.opacity = String(.16 * (1 - progress));
      setState({ isTracking: true, isDragging: dragging, progress, translateX: x, canGoBack });
    });
  }

  function resetStyles(updateState = true) {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    for (const element of [pageRef.current, underlayRef.current]) {
      element?.style.removeProperty("transition");
      element?.style.removeProperty("transform");
    }
    dimRef.current?.style.removeProperty("opacity");
    if (updateState) setState({ isTracking: false, isDragging: false, progress: 0, translateX: 0, canGoBack });
  }

  function animateBack() {
    const page = pageRef.current;
    const underlay = underlayRef.current;
    if (page) page.style.transition = `transform ${SWIPE_BACK_TRANSITION_MS}ms cubic-bezier(.22,1,.36,1)`;
    if (underlay) underlay.style.transition = `transform ${SWIPE_BACK_TRANSITION_MS}ms cubic-bezier(.22,1,.36,1)`;
    applyPosition(0, gestureRef.current?.width || window.innerWidth, false);
    timerRef.current = window.setTimeout(resetStyles, SWIPE_BACK_TRANSITION_MS + 10);
  }

  function completeBack(width: number) {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onBack();
      transitioningRef.current = false;
      resetStyles();
      return;
    }
    if (pageRef.current) pageRef.current.style.transition = `transform ${SWIPE_BACK_TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1)`;
    if (underlayRef.current) underlayRef.current.style.transition = `transform ${SWIPE_BACK_TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1)`;
    applyPosition(width, width, false);
    timerRef.current = window.setTimeout(() => {
      const navigated = onBack();
      transitioningRef.current = false;
      if (!navigated) {
        resetStyles();
        return;
      }
      // Keep the outgoing page offscreen until the browser popstate removes it.
      timerRef.current = window.setTimeout(resetStyles, 500);
    }, SWIPE_BACK_TRANSITION_MS);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const localX = event.clientX - event.currentTarget.getBoundingClientRect().left;
    if (!canGoBack
      || transitioningRef.current
      || hasNavigationOverlay()
      || !isSwipeBackStart(localX)
      || (event.pointerType === "mouse" && navigator.maxTouchPoints === 0)
      || swipeBackTargetIsBlocked(event.target, event.currentTarget)) return;
    gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastAt: performance.now(), velocity: 0, width: window.innerWidth, dragging: false, rejected: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setState((current) => ({ ...current, isTracking: true, canGoBack }));
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.rejected) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.dragging) {
      const intent = swipeBackIntent(dx, dy);
      if (intent === "pending") return;
      if (intent === "rejected") {
        gesture.rejected = true;
        return;
      }
      gesture.dragging = true;
    }
    event.preventDefault();
    const now = performance.now();
    gesture.velocity = Math.max(0, event.clientX - gesture.lastX) / Math.max(1, now - gesture.lastAt);
    gesture.lastX = event.clientX;
    gesture.lastAt = now;
    applyPosition(clampSwipeDistance(dx, gesture.width), gesture.width, true);
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled || gesture.rejected || !gesture.dragging) {
      animateBack();
      return;
    }
    const distance = clampSwipeDistance(gesture.lastX - gesture.startX, gesture.width);
    if (shouldCompleteSwipe(distance, gesture.width, gesture.velocity)) completeBack(gesture.width);
    else animateBack();
  }

  useEffect(() => {
    setState((current) => ({ ...current, canGoBack }));
    const cancel = () => {
      const gesture = gestureRef.current;
      if (gesture && pageRef.current?.hasPointerCapture(gesture.pointerId)) pageRef.current.releasePointerCapture(gesture.pointerId);
      gestureRef.current = null;
      transitioningRef.current = false;
      resetStyles(false);
    };
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("resize", cancel);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      resetStyles();
    };
  }, [canGoBack]);

  return {
    state,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => finish(event),
      onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => finish(event, true),
      onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => finish(event, true),
    },
  };
}

export function SwipeBackContainer({ canGoBack, onBack, page, children }: { canGoBack: boolean; onBack: () => boolean; page?: ReactNode; children: ReactNode }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const underlayRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLSpanElement>(null);
  const leadingGuardRef = useRef<HTMLSpanElement>(null);
  const trailingGuardRef = useRef<HTMLSpanElement>(null);
  const { bind, state } = useSwipeBack({ canGoBack, onBack, pageRef, underlayRef, dimRef });
  useEffect(() => {
    const preventNativeHistory = (event: TouchEvent) => event.preventDefault();
    const guards = [leadingGuardRef.current, trailingGuardRef.current];
    guards.forEach((guard) => guard?.addEventListener("touchstart", preventNativeHistory, { passive: false }));
    return () => guards.forEach((guard) => guard?.removeEventListener("touchstart", preventNativeHistory));
  }, []);
  return <div className={`swipe-back-stage${state.isDragging ? " is-dragging" : ""}`}>
    <span ref={leadingGuardRef} className="native-history-guard native-history-guard--leading" aria-hidden="true" />
    <span ref={trailingGuardRef} className="native-history-guard native-history-guard--trailing" aria-hidden="true" />
    <div ref={underlayRef} className={canGoBack ? "swipe-back-underlay" : "swipe-back-base"} aria-hidden={canGoBack || undefined} inert={canGoBack || undefined}>
      {children}
      {canGoBack && <span ref={dimRef} className="swipe-back-dim" />}
    </div>
    {canGoBack && <div ref={pageRef} className="swipe-back-page" {...bind}>{page}</div>}
  </div>;
}
