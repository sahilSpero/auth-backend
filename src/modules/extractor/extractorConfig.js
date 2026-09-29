// Phase 1 — deterministic page segmentation constants (see phase-1-playwright.md)
const VIEWPORT = {
  width: 400,
  height: 844,
};

const SECTION_HEIGHT = 400;
const SECTION_STEP = 300;
const OVERLAP = SECTION_HEIGHT - SECTION_STEP; // 100px overlap between windows

const EXTRACTION_VERSION = "phase1-v1";
const OUTPUT_DIR = "output";

module.exports = {
  VIEWPORT,
  SECTION_HEIGHT,
  SECTION_STEP,
  OVERLAP,
  EXTRACTION_VERSION,
  OUTPUT_DIR,
};
