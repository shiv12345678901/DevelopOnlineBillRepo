import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applePlatformOwnsEdgeBack,
  clampSwipeDistance,
  shouldCompleteSwipe,
  SWIPE_BACK_EDGE_PX,
  SWIPE_BACK_TRANSITION_MS,
  swipeBackIntent,
} from "../src/swipeBack.ts";
import { closeTopNavigationOverlay, registerNavigationOverlay } from "../src/navigationOverlays.ts";

const componentSource = await readFile(new URL("../src/components/SwipeBackContainer.tsx", import.meta.url), "utf8");
const navigationSource = await readFile(new URL("../src/useNavigationHistory.ts", import.meta.url), "utf8");
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/index.css", import.meta.url), "utf8");

test("edge swipe uses the required activation area and mobile transition", () => {
  assert.equal(SWIPE_BACK_EDGE_PX, 24);
  assert.ok(SWIPE_BACK_TRANSITION_MS >= 220 && SWIPE_BACK_TRANSITION_MS <= 280);
  assert.match(componentSource, /event\.clientX > SWIPE_BACK_EDGE_PX/);
  assert.match(componentSource, /navigator\.maxTouchPoints/);
});

test("Apple touch platforms defer to the native edge-back transition", () => {
  assert.equal(applePlatformOwnsEdgeBack("Mozilla/5.0 (iPhone)", "iPhone", 5), true);
  assert.equal(applePlatformOwnsEdgeBack("Mozilla/5.0 (Macintosh)", "MacIntel", 5), true);
  assert.equal(applePlatformOwnsEdgeBack("Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", 5), false);
  assert.match(componentSource, /applePlatformOwnsEdgeBack\(navigator\.userAgent, navigator\.platform, navigator\.maxTouchPoints\)/);
});

test("gesture waits for a horizontal movement threshold and rejects vertical or leftward motion", () => {
  assert.equal(swipeBackIntent(7, 0), "pending");
  assert.equal(swipeBackIntent(12, 3), "horizontal");
  assert.equal(swipeBackIntent(4, 12), "rejected");
  assert.equal(swipeBackIntent(-14, 1), "rejected");
  assert.equal(clampSwipeDistance(-20, 390), 0);
  assert.equal(clampSwipeDistance(500, 390), 390);
});

test("distance and release velocity independently complete a swipe", () => {
  assert.equal(shouldCompleteSwipe(117, 390, .1), true);
  assert.equal(shouldCompleteSwipe(40, 390, .51), true);
  assert.equal(shouldCompleteSwipe(100, 390, .2), false);
});

test("topmost overlay closes before page navigation", () => {
  const closed = [];
  const removeSheet = registerNavigationOverlay(400, () => closed.push("sheet"));
  const removeDialog = registerNavigationOverlay(600, () => closed.push("dialog"));
  assert.equal(closeTopNavigationOverlay(), true);
  assert.deepEqual(closed, ["dialog"]);
  removeDialog();
  assert.equal(closeTopNavigationOverlay(), true);
  assert.deepEqual(closed, ["dialog", "sheet"]);
  removeSheet();
  assert.equal(closeTopNavigationOverlay(), false);
});

test("gesture conflicts, cancellation, reduced motion and cleanup are handled centrally", () => {
  assert.match(componentSource, /\[data-disable-swipe-back\]/);
  assert.match(componentSource, /overflowX === "auto"/);
  assert.match(componentSource, /onPointerCancel/);
  assert.match(componentSource, /prefers-reduced-motion: reduce/);
  assert.match(componentSource, /releasePointerCapture/);
  assert.match(componentSource, /removeEventListener\("resize"/);
  assert.match(componentSource, /transitioningRef\.current/);
});

test("browser, header and swipe Back share real app history with a safe Home fallback", () => {
  assert.match(navigationSource, /window\.history\.back\(\)/);
  assert.match(navigationSource, /const fallbackTab: TabId = "home"/);
  assert.match(navigationSource, /closeTopNavigationOverlay\(\)/);
  assert.match(navigationSource, /tabScrollRef/);
  assert.match(navigationSource, /window\.scrollTo/);
  assert.match(appSource, /onBack=\{goBack\}/);
  assert.match(appSource, /onBack=\{\(\) => \{ void goBack\(\); \}\}/);
});

test("bottom tabs replace their marker while pushed pages add one history entry", () => {
  assert.match(navigationSource, /pushPage[\s\S]*window\.history\.pushState/);
  assert.match(navigationSource, /selectTab[\s\S]*window\.history\.replaceState/);
  assert.match(appSource, /pushPage\(\{ id: "history" \}\)/);
  assert.match(appSource, /pushPage\(\{ id: "evidence", evidence \}\)/);
});

test("returning from a pushed page prunes its stale browser-forward snapshot", () => {
  assert.match(navigationSource, /const nextPages = currentPages\.slice\(0, -1\)[\s\S]*window\.history\.pushState\(marker\(nextPages\.length\)/);
  assert.match(navigationSource, /ordinary bottom-tab switches still replace their single root entry/);
});

test("pushed pages cover the complete app width without exposing the underlay gutter", () => {
  assert.match(cssSource, /--page-inline-padding: 20px/);
  assert.match(cssSource, /\.swipe-back-stage \{[^}]*width: calc\(100% \+ var\(--page-inline-padding\) \+ var\(--page-inline-padding\)\)/);
  assert.match(cssSource, /\.swipe-back-page \{[^}]*padding-inline: var\(--page-inline-padding\)/);
  assert.match(cssSource, /\.swipe-back-stage \{[^}]*overflow-x: clip/);
  assert.match(cssSource, /\.swipe-back-stage \{[^}]*overflow-y: visible/);
  assert.doesNotMatch(cssSource, /\.screen--evidence-detail \{[^}]*margin-top:\s*-/);
});
