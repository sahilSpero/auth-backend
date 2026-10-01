// Phase 1 — deterministic page segmentation constants (see phase-1-playwright.md)

// The fixed mobile viewport every page is rendered at.
// Only the WIDTH (400px) really matters for segmentation;
// HEIGHT is just the browser window size, NOT the section size.
const VIEWPORT = {
  width: 400,
  height: 844,
};

// Sections are one full mobile screen tall (844px), advancing by
// SECTION_HEIGHT - OVERLAP each step. The 100px overlap is intentional so a
// component sitting on a boundary is fully visible in at least one section.
const SECTION_HEIGHT = VIEWPORT.height; // 844 — one mobile screen per section
const OVERLAP = 100;
const SECTION_STEP = SECTION_HEIGHT - OVERLAP; // 744

// M6 warm-up scroll: lazy content only renders when its region nears the
// viewport, so we step-scroll through the page before measuring/planning.
// The caps exist because ads/infinite feeds can grow a document forever —
// hitting any cap continues extraction with whatever height we have + a warning.
const WARMUP = {
  SCROLL_STEP: 600, // px per step — small enough to cross every lazy zone
  STEP_DELAY_MS: 400, // pause for IntersectionObserver content to mount
  STABLE_ROUNDS: 2, // stop when at bottom AND height unchanged for N checks
  SETTLE_MS: 800, // quiet period after scrolling back to top
  MAX_SCROLL_STEPS: 80, // ~48k px of scrolling max
  MAX_PAGE_HEIGHT: 60000, // stop growing the plan past this
  MAX_WARMUP_TIME_MS: 45000, // wall-clock cap on the whole warm-up
  MIN_REASONABLE_HEIGHT: 2000, // below → warn (page likely lazy-gated/blocked)
};

// Paginated / infinite-feed handling. Phase 2 only needs a few windows of a
// repeating feed to identify the component — loading all N pages wastes API
// calls and produces dozens of identical sections.
const FEED = {
  MAX_CALLS: 3, // allow this many calls to the same paginated endpoint, then block
  MAX_FEED_SECTIONS: 3, // keep this many sections per repeated-structure run
};

const EXTRACTION_VERSION = "phase1-v1";
const OUTPUT_DIR = "output";

module.exports = {
  VIEWPORT,
  SECTION_HEIGHT,
  SECTION_STEP,
  OVERLAP,
  WARMUP,
  FEED,
  EXTRACTION_VERSION,
  OUTPUT_DIR,
};
