import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function IosSheet({ open, onClose, label, children, className = "" }: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const contentRef = useRef(children);
  const closingRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startY: number; lastY: number; startedAt: number } | null>(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  onCloseRef.current = onClose;
  if (open) contentRef.current = children;

  useEffect(() => {
    if (open) {
      setMounted(true);
      closingRef.current = false;
      setClosing(false);
      return;
    }
    if (!mounted) return;
    closingRef.current = true;
    setClosing(true);
    const timer = window.setTimeout(() => setMounted(false), 260);
    return () => window.clearTimeout(timer);
  }, [mounted, open]);

  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closingRef.current) beginClose();
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

  function beginClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    if (sheetRef.current) {
      sheetRef.current.style.removeProperty("transition");
      sheetRef.current.style.removeProperty("transform");
    }
    window.setTimeout(() => onCloseRef.current(), 220);
  }

  function startDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (closingRef.current || !sheetRef.current) return;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, startedAt: performance.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
    sheetRef.current.style.transition = "none";
  }

  function moveDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !sheetRef.current) return;
    drag.lastY = event.clientY;
    const offset = Math.max(0, event.clientY - drag.startY);
    sheetRef.current.style.transform = `translateY(${offset}px)`;
  }

  function endDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !sheetRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const distance = Math.max(0, drag.lastY - drag.startY);
    const velocity = distance / Math.max(1, performance.now() - drag.startedAt);
    sheetRef.current.style.removeProperty("transition");
    sheetRef.current.style.removeProperty("transform");
    if (distance > Math.min(140, sheetRef.current.offsetHeight * .24) || velocity > .65) beginClose();
  }

  if (!mounted) return null;
  return createPortal(
    <div className={`ios-sheet-layer${closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) beginClose(); }}>
      <section ref={sheetRef} className={`ios-sheet ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <span className="ios-sheet-grabber-zone" aria-hidden="true" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><span className="ios-sheet-grabber" /></span>
        {open ? children : contentRef.current}
      </section>
    </div>,
    document.body,
  );
}
