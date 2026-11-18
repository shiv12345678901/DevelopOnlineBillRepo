export const NATIVE_HISTORY_GUARD_PX = 20;
export const SWIPE_BACK_EDGE_PX = 72;
export const SWIPE_BACK_ACTIVATION_PX = 8;
export const SWIPE_BACK_DISTANCE_RATIO = .3;
export const SWIPE_BACK_VELOCITY_PX_MS = .5;
export const SWIPE_BACK_TRANSITION_MS = 240;

export function isSwipeBackStart(localX: number) {
  return localX >= 0 && localX <= SWIPE_BACK_EDGE_PX;
}

export function swipeBackIntent(dx: number, dy: number): "pending" | "horizontal" | "rejected" {
  if (Math.hypot(dx, dy) < SWIPE_BACK_ACTIVATION_PX) return "pending";
  return dx > 0 && Math.abs(dx) > Math.abs(dy) ? "horizontal" : "rejected";
}

export function shouldCompleteSwipe(distance: number, width: number, velocity: number) {
  return distance >= width * SWIPE_BACK_DISTANCE_RATIO || velocity > SWIPE_BACK_VELOCITY_PX_MS;
}

export function clampSwipeDistance(distance: number, width: number) {
  return Math.max(0, Math.min(width, distance));
}
