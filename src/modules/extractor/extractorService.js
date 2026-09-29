const { chromium } = require("playwright");
const {
  VIEWPORT,
  SECTION_HEIGHT,
  SECTION_STEP,
  EXTRACTION_VERSION,
} = require("./extractorConfig");

// Fixed windows: 400px tall, advancing 300px each step.
// The last window is the first one whose bottom reaches/passes the page bottom.
const planSections = (pageHeight) => {
  const sections = [];
  let start = 0;

  while (true) {
    const end = Math.min(start + SECTION_HEIGHT, pageHeight);
    const index = sections.length + 1;
    sections.push({
      sectionId: `section-${String(index).padStart(3, "0")}`,
      index,
      range: { start, end, height: end - start },
    });
    if (start + SECTION_HEIGHT >= pageHeight) break;
    start += SECTION_STEP;
  }

  return sections;
};

const measurePageHeight = async (page) => {
  return page.evaluate(() =>
    Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    )
  );
};

// M1: render page at 400px mobile viewport, wait for readiness,
// measure document height, compute the deterministic section plan.
const extractPage = async (url) => {
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      deviceScaleFactor: 1,
      isMobile: true,
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.evaluate(() => document.fonts?.ready);

    const pageHeight = await measurePageHeight(page);
    const sections = planSections(pageHeight);

    return {
      url,
      viewport: { ...VIEWPORT },
      pageHeight,
      sectionHeight: SECTION_HEIGHT,
      sectionStep: SECTION_STEP,
      sectionCount: sections.length,
      sections,
      extractionVersion: EXTRACTION_VERSION,
    };
  } finally {
    await browser.close();
  }
};

module.exports = {
  extractPage,
  planSections,
};
