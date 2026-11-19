import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clampSwipeDistance,
  isSwipeBackStart,
  NATIVE_HISTORY_GUARD_PX,
  shouldCompleteSwipe,
  SWIPE_BACK_MAX_START_PX,
  SWIPE_BACK_START_RATIO,
  SWIPE_BACK_TRANSITION_MS,
  swipeBackIntent,
} from "../src/swipeBack.ts";
import { closeTopNavigationOverlay, registerNavigationOverlay } from "../src/navigationOverlays.ts";

const componentSource = await readFile(new URL("../src/components/SwipeBackContainer.tsx", import.meta.url), "utf8");
const navigationSource = await readFile(new URL("../src/useNavigationHistory.ts", import.meta.url), "utf8");
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/index.css", import.meta.url), "utf8");

test("edge swipe uses the required activation area and mobile transition", () => {
  assert.equal(NATIVE_HISTORY_GUARD_PX, 20);
  assert.equal(SWIPE_BACK_START_RATIO, .4);
  assert.equal(SWIPE_BACK_MAX_START_PX, 160);
  assert.ok(SWIPE_BACK_TRANSITION_MS >= 220 && SWIPE_BACK_TRANSITION_MS <= 280);
  assert.equal(isSwipeBackStart(-1, 390), false);
  assert.equal(isSwipeBackStart(0, 390), true);
  assert.equal(isSwipeBackStart(120, 390), true);
  assert.equal(isSwipeBackStart(156, 390), true);
  assert.equal(isSwipeBackStart(157, 390), false);
  assert.equal(isSwipeBackStart(160, 520), true);
  assert.equal(isSwipeBackStart(161, 520), false);
  assert.match(componentSource, /const bounds = boundary\.getBoundingClientRect\(\)/);
  assert.match(componentSource, /touch\.clientX - bounds\.left/);
  assert.match(componentSource, /!isSwipeBackStart\(localX, bounds\.width\)/);
  assert.match(componentSource, /addEventListener\("touchstart", onTouchStart, \{ passive: false \}\)/);
  assert.match(componentSource, /Claim the gesture before Safari/);
});

test("physical browser edges are reserved so Safari cannot navigate root tabs", () => {
  assert.match(componentSource, /\{!canGoBack && <>/);
  assert.match(componentSource, /if \(canGoBack\) return/);
  assert.match(componentSource, /native-history-guard--leading/);
  assert.match(componentSource, /native-history-guard--trailing/);
  assert.match(componentSource, /addEventListener\("touchstart", preventNativeHistory, \{ passive: false \}\)/);
  assert.match(cssSource, /\.native-history-guard \{[^}]*width: 20px;[^}]*touch-action: none/);
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
  const applyPositionStart = componentSource.indexOf("function applyPosition");
  const applyPositionSource = componentSource.slice(applyPositionStart, componentSource.indexOf("function resetStyles", applyPositionStart));
  assert.match(componentSource, /\[data-disable-swipe-back\]/);
  assert.match(componentSource, /"button"/);
  assert.match(componentSource, /"\[role='button'\]"/);
  assert.match(componentSource, /overflowX === "auto"/);
  assert.match(componentSource, /addEventListener\("touchcancel"/);
  assert.match(componentSource, /prefers-reduced-motion: reduce/);
  assert.match(componentSource, /removeEventListener\("touchstart"/);
  assert.match(componentSource, /removeEventListener\("resize"/);
  assert.match(componentSource, /transitioningRef\.current/);
  assert.doesNotMatch(applyPositionSource, /setState/);
  assert.match(componentSource, /addEventListener\("transitionend", handleTransitionEnd\)/);
  assert.match(componentSource, /event\.propertyName === "transform"/);
  assert.match(componentSource, /SWIPE_BACK_TRANSITION_MS \+ 80/);
  assert.match(componentSource, /resetStyles\(false\)/);
});

test("completed swipe stays offscreen until React removes the outgoing page", () => {
  const completeBackStart = componentSource.indexOf("function completeBack");
  const completeBackSource = componentSource.slice(completeBackStart, componentSource.indexOf("function onTouchStart", completeBackStart));
  assert.match(completeBackSource, /if \(!navigated\) \{\s*resetStyles\(\);\s*return;\s*\}/);
  assert.match(completeBackSource, /setState\(\{ isTracking: false, isDragging: false \}\)/);
  assert.doesNotMatch(completeBackSource, /\}\s*resetStyles\(\);\s*\}\);/);
});

test("back navigation restores scroll after layout but before the revealed page paints", () => {
  const helperStart = navigationSource.indexOf("const showPreviousPage");
  const helperSource = navigationSource.slice(helperStart, navigationSource.indexOf("}, [marker]);", helperStart));
  assert.ok(helperSource.indexOf("restoreScrollRef.current = restoredScrollY") < helperSource.indexOf("setPages(nextPages)"));
  assert.match(navigationSource, /useLayoutEffect\(\(\) => \{[\s\S]*window\.scrollTo\(\{ top: restoreScrollRef\.current, behavior: "instant" \}\)/);
  assert.doesNotMatch(navigationSource, /requestAnimationFrame\(\(\) => window\.scrollTo/);
});

test("interactive swipe reveals the root at its saved scroll position", () => {
  assert.match(componentSource, /const offsetY = window\.scrollY - underlayScrollY/);
  assert.match(componentSource, /underlayContentRef\.current\.style\.transform = `translate3d\(0,\$\{offsetY\}px,0\)`/);
  assert.match(componentSource, /className="swipe-back-underlay-content"/);
  assert.match(appSource, /underlayScrollY=\{activePage\?\.scrollY \?\? 0\}/);
});

test("browser, header and detail swipe Back share real page history", () => {
  assert.match(navigationSource, /window\.history\.back\(\)/);
  assert.match(navigationSource, /const fallbackTab: TabId = "home"/);
  assert.match(navigationSource, /closeTopNavigationOverlay\(\)/);
  assert.match(navigationSource, /tabScrollRef/);
  assert.match(navigationSource, /window\.scrollTo/);
  assert.match(appSource, /onBack=\{goBack\}/);
  assert.match(appSource, /onBack=\{\(\) => \{ void goBack\(\); \}\}/);
  assert.match(navigationSource, /ignoreNextPopRef\.current = true;\n\s*showPreviousPage\(pagesRef\.current\);\n\s*window\.history\.back\(\)/);
  assert.match(navigationSource, /if \(ignoreNextPopRef\.current\)[\s\S]*ignoreNextPopRef\.current = false/);
});

test("bottom tabs replace their marker while pushed pages add one history entry", () => {
  assert.match(navigationSource, /pushPage[\s\S]*window\.history\.pushState/);
  assert.match(navigationSource, /selectTab[\s\S]*window\.history\.replaceState/);
  assert.match(navigationSource, /if \(pagesRef\.current\.length\)[\s\S]*pendingTabRef\.current = nextTab;[\s\S]*window\.history\.back\(\)/);
  assert.match(navigationSource, /const pendingTab = pendingTabRef\.current;[\s\S]*window\.history\.replaceState\(marker\(0, pendingTab\)/);
  assert.match(appSource, /pushPage\(\{ id: "history" \}\)/);
  assert.match(appSource, /pushPage\(\{ id: "evidence", evidence \}\)/);
});

test("root tabs use one launch entry and cannot build a swipe-back stack", () => {
  const helperStart = navigationSource.indexOf("const showPreviousPage");
  const pagePopBranch = navigationSource.slice(helperStart, navigationSource.indexOf("}, [marker]);", helperStart));
  assert.match(navigationSource, /window\.history\.replaceState\(marker\(0, initialTab\)/);
  assert.doesNotMatch(navigationSource, /marker\(-1/);
  assert.doesNotMatch(navigationSource, /guard\??:/);
  assert.match(pagePopBranch, /setPages\(nextPages\)/);
  assert.doesNotMatch(pagePopBranch, /window\.history\.pushState/);
  assert.match(navigationSource, /already-closed pushed page/);
});

test("pushed pages cover the complete app width without exposing the underlay gutter", () => {
  assert.match(cssSource, /--page-inline-padding: 20px/);
  assert.match(cssSource, /--page-top-padding: calc\(env\(safe-area-inset-top, 0px\) \+ 32px\)/);
  assert.match(cssSource, /\.swipe-back-stage \{[^}]*width: calc\(100% \+ var\(--page-inline-padding\) \+ var\(--page-inline-padding\)\)/);
  assert.match(cssSource, /\.swipe-back-stage \{[^}]*min-height: 100dvh/);
  assert.match(cssSource, /\.swipe-back-stage \{[^}]*margin-top: calc\(0px - var\(--page-top-padding\)\)/);
  assert.match(cssSource, /\.swipe-back-page \{[^}]*padding: var\(--page-top-padding\) var\(--page-inline-padding\) var\(--page-bottom-padding\)/);
  assert.match(cssSource, /\.swipe-back-stage \{[^}]*overflow-x: clip/);
  assert.match(cssSource, /\.swipe-back-stage \{[^}]*overflow-y: visible/);
  assert.match(cssSource, /\.swipe-back-page \{[^}]*background-image: var\(--background-wash\)/);
  assert.match(cssSource, /\.swipe-back-underlay \{[^}]*translate3d\(-30%, 0, 0\)/);
  assert.match(cssSource, /\.swipe-back-stage\.is-tracking \.swipe-back-page \{[^}]*box-shadow: -10px 0 28px/);
  assert.doesNotMatch(cssSource, /\.screen--evidence-detail \{[^}]*margin-top:\s*-/);
});
