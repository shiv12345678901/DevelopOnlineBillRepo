type OverlayEntry = { id: symbol; priority: number; close: () => void };

const overlays: OverlayEntry[] = [];

export const OVERLAY_PRIORITY = {
  confirmation: 600,
  popover: 500,
  sheet: 400,
  modal: 300,
  search: 200,
} as const;

export function registerNavigationOverlay(priority: number, close: () => void) {
  const entry: OverlayEntry = { id: Symbol("navigation-overlay"), priority, close };
  overlays.push(entry);
  return () => {
    const index = overlays.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) overlays.splice(index, 1);
  };
}

export function closeTopNavigationOverlay() {
  const top = overlays.reduce<OverlayEntry | null>((current, candidate) => !current || candidate.priority >= current.priority ? candidate : current, null);
  if (!top) return false;
  top.close();
  return true;
}

export function hasNavigationOverlay() {
  return overlays.length > 0;
}
