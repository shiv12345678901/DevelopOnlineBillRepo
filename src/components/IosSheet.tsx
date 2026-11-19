import { useEffect, useRef, useState, type AnimationEvent as ReactAnimationEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OVERLAY_PRIORITY, registerNavigationOverlay } from "../navigationOverlays";

const CLOSE_DURATION_MS = 260;
const RETURN_DURATION_MS = 280;

type SheetDrag = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastAt: number;
  velocity: number;
};

export function IosSheet({ open, onClose, label, children, className = "", overlayPriority = OVERLAY_PRIORITY.sheet, dismissible = true }: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  overlayPriority?: number;
  dismissible?: boolean;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const contentRef = useRef(children);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const returnTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<SheetDrag | null>(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  onCloseRef.current = onClose;
  if (open) contentRef.current = children;

  function clearMotionTimers() {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (returnTimerRef.current !== null) window.clearTimeout(returnTimerRef.current);
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    closeTimerRef.current = null;
    returnTimerRef.current = null;
    frameRef.current = null;
  }

  function resetInlineMotion() {
    sheetRef.current?.style.removeProperty("transition");
    sheetRef.current?.style.removeProperty("transform");
    if (layerRef.current) layerRef.current.style.backgroundColor = "transparent";
  }

  function finishClose() {
    clearMotionTimers();
    setMounted(false);
    onCloseRef.current();
  }

  function animateClosed() {
    if (closingRef.current || !dismissible) return;
    closingRef.current = true;
    setClosing(true);
    const sheet = sheetRef.current;
    if (!sheet) {
      finishClose();
      return;
    }

    const distance = Math.max(sheet.offsetHeight + 32, window.innerHeight - sheet.getBoundingClientRect().top + 32);
    sheet.style.transition = `transform ${CLOSE_DURATION_MS}ms cubic-bezier(.32,.72,0,1)`;
    layerRef.current?.style.removeProperty("background-color");
    // Keep the finger's final transform for this frame, then continue down.
    frameRef.current = window.requestAnimationFrame(() => {
      sheet.style.transform = `translate3d(0,${distance}px,0)`;
    });
    closeTimerRef.current = window.setTimeout(finishClose, CLOSE_DURATION_MS + 20);
  }

  useEffect(() => {
    if (open) {
      clearMotionTimers();
      setMounted(true);
      closingRef.current = false;
      setClosing(false);
      window.requestAnimationFrame(resetInlineMotion);
    } else if (mounted && !closingRef.current) {
      animateClosed();
    }
  }, [mounted, open]);

  useEffect(() => open ? registerNavigationOverlay(overlayPriority, dismissible ? animateClosed : () => undefined) : undefined, [dismissible, open, overlayPriority]);

  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) {
        event.preventDefault();
        sheetRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true }));
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mounted]);

  useEffect(() => () => {
    clearMotionTimers();
    const drag = dragRef.current;
    if (drag && sheetRef.current?.hasPointerCapture(drag.pointerId)) sheetRef.current.releasePointerCapture(drag.pointerId);
  }, []);

  function startDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (closingRef.current || !dismissible || !sheetRef.current) return;
    clearMotionTimers();
    const now = performance.now();
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastAt: now, velocity: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    sheetRef.current.style.animation = "none";
    sheetRef.current.style.transition = "none";
    layerRef.current?.style.removeProperty("transition");
  }

  function moveDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !sheet) return;
    const now = performance.now();
    const deltaY = event.clientY - drag.lastY;
    const elapsed = Math.max(1, now - drag.lastAt);
    drag.velocity = Math.max(0, deltaY / elapsed);
    drag.lastY = event.clientY;
    drag.lastAt = now;
    const offset = Math.max(0, event.clientY - drag.startY);
    const progress = Math.min(1, offset / Math.max(1, sheet.offsetHeight));
    sheet.style.transform = `translate3d(0,${offset}px,0)`;
    if (layerRef.current) layerRef.current.style.backgroundColor = `rgba(0,0,0,${(.5 * (1 - progress)).toFixed(3)})`;
  }

  function returnToOpen() {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = `transform ${RETURN_DURATION_MS}ms cubic-bezier(.22,1,.36,1)`;
    sheet.style.transform = "translate3d(0,0,0)";
    if (layerRef.current) {
      layerRef.current.style.transition = `background-color ${RETURN_DURATION_MS}ms ease-out`;
      layerRef.current.style.backgroundColor = "rgba(0,0,0,.5)";
    }
    returnTimerRef.current = window.setTimeout(() => {
      resetInlineMotion();
      layerRef.current?.style.removeProperty("transition");
    }, RETURN_DURATION_MS);
  }

  function endDrag(event: ReactPointerEvent<HTMLSpanElement>, cancelled = false) {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !sheet) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const distance = Math.max(0, drag.lastY - drag.startY);
    const releaseVelocity = performance.now() - drag.lastAt < 80 ? drag.velocity : 0;
    if (!cancelled && (distance > Math.min(140, sheet.offsetHeight * .24) || releaseVelocity > .65)) {
      animateClosed();
      return;
    }
    returnToOpen();
  }

  function finishEntranceAnimation(event: ReactAnimationEvent<HTMLElement>) {
    if (event.animationName === "iosSheetIn") event.currentTarget.style.animation = "none";
  }

  if (!mounted) return null;
  return createPortal(
    <div ref={layerRef} className={`ios-sheet-layer${closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) animateClosed(); }}>
      <section ref={sheetRef} className={`ios-sheet ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onAnimationEnd={finishEntranceAnimation}>
        <span className={`ios-sheet-grabber-zone${dismissible ? "" : " is-disabled"}`} aria-hidden="true" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={(event) => endDrag(event)} onPointerCancel={(event) => endDrag(event, true)} onLostPointerCapture={(event) => endDrag(event, true)}><span className="ios-sheet-grabber" /></span>
        {open ? children : contentRef.current}
      </section>
    </div>,
    document.body,
  );
}
