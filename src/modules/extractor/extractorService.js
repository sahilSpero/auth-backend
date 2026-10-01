const path = require("path");
const { chromium } = require("playwright");
const {
  VIEWPORT,
  SECTION_HEIGHT,
  SECTION_STEP,
  OVERLAP,
  WARMUP,
  FEED,
  EXTRACTION_VERSION,
} = require("./extractorConfig");
const {
  OUTPUT_ROOT,
  resetOutputDir,
  ensureSectionDir,
  writeJson,
  writeText,
} = require("./outputWriter");

// ─── Playwright mental model (for anyone new to the library) ────────────────
//   browser  → the Chromium process itself (expensive to launch)
//   context  → an isolated "profile" inside it: own viewport, cookies, storage
//   page     → a single tab inside a context; this is what we drive
// Everything is async — every page.* call is a Promise.

// Build the deterministic window plan for a page of a known height.
// Windows start at y=0 and advance by SECTION_STEP (744px) until the first
// window whose bottom edge reaches/passes the document bottom — that one is
// the last, and its `end` is clamped to the real page height.
//
// Example, pageHeight = 2400:
//   0→844, 744→1588, 1488→2332, 2232→2400 (clamped from 3076)
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
    if (start + SECTION_HEIGHT >= pageHeight) break; // bottom reached — done
    start += SECTION_STEP;
  }

  return sections;
};

// document height = the tallest of several DOM measurements; different sites
// report it on different nodes, so we take the max to be safe.
// NOTE: page.evaluate() runs this function INSIDE the browser page, not in
// Node — `document` exists there, not here. The return value is serialized
// back to Node.
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

// ─── Paginated / infinite feeds ─────────────────────────────────────────────
// Query/body params whose values change every page — stripping them makes
// "?page=1" and "?page=2" share one normalized key.
const PAGINATION_PARAM =
  /^(page|p|pg|paged|pagenum|page_no|cursor|offset|start|after|limit|per_page|page_size|pagesize|_page|skip|from|index)$/i;

// Two requests are "the same paginated call" when they share method + path +
// all NON-pagination params + normalized body. Keeping operationName matters:
// GraphQL endpoints would otherwise collapse every operation into one key.
const normalizeRequestKey = (request) => {
  const url = new URL(request.url());
  const kept = [...url.searchParams.entries()]
    .filter(([k]) => !PAGINATION_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b));

  let key = `${request.method()} ${url.origin}${url.pathname}` +
    `?${new URLSearchParams(kept).toString()}`;

  if (["POST", "PUT", "PATCH"].includes(request.method())) {
    try {
      const body = request.postDataJSON();
      if (body && typeof body === "object") {
        const cleaned = { ...body };
        for (const k of Object.keys(cleaned)) {
          if (PAGINATION_PARAM.test(k)) delete cleaned[k];
        }
        if (cleaned.operationName) key += ` op:${cleaned.operationName}`;
        key += " " + JSON.stringify(cleaned);
      }
    } catch {
      key += " " + (request.postData() || "");
    }
  }
  return key;
};

// Raw identity INCLUDING pagination — used to distinguish "same endpoint,
// changing page param" (a feed) from "identical call repeated" (a poll or
// analytics beacon, which must NOT be blocked).
const rawRequestKey = (request) =>
  `${request.method()} ${request.url()} ${request.postData() || ""}`;

// Intercept every request on the context. XHR/fetch calls get normalized and
// counted; once a key has been called > MAX_CALLS times with DISTINCT raw
// forms (i.e. only the page param differs), further calls are aborted.
// Blocking stops both the API spam AND the DOM growth at the source.
// Returns a handle whose summary() feeds page.json diagnostics.
const trackPaginatedFeeds = (context) => {
  const stats = new Map(); // normalizedKey -> {allowed, blocked, distinct:Set}

  return {
    async register() {
      await context.route("**/*", (route) => {
        const req = route.request();
        if (!["xhr", "fetch"].includes(req.resourceType())) {
          return route.continue();
        }
        const key = normalizeRequestKey(req);
        const entry =
          stats.get(key) || { allowed: 0, blocked: 0, distinct: new Set() };
        stats.set(key, entry);

        if (entry.allowed >= FEED.MAX_CALLS && entry.distinct.size >= 2) {
          entry.blocked++;
          return route.abort();
        }
        entry.allowed++;
        entry.distinct.add(rawRequestKey(req));
        return route.continue();
      });
    },
    summary() {
      return [...stats.entries()]
        .filter(([, e]) => e.blocked > 0)
        .map(([endpoint, e]) => ({
          endpoint,
          callsAllowed: e.allowed,
          callsBlocked: e.blocked,
        }));
    },
  };
};

// Fallback for feeds that grow the DOM WITHOUT repeating XHR (SSR streams,
// scroll-linked DOM injection): consecutive windows showing the same root
// structure are the same feed repeating. Signature = structure of the chosen
// roots — positions intentionally ignored since they shift every window.
const sectionSignature = (roots) =>
  roots
    .map((r) => `${r.tag}.${r.cls || ""}`)
    .sort()
    .join("|");

// A run is a stretch of sections with identical signatures. Keep the first
// MAX_FEED_SECTIONS of each run; the rest are marked collapsedInto the run's
// first section — no folder, no screenshot, just a pointer in page.json.
const markCollapsedRuns = (sections) => {
  let runStart = 0;
  for (let i = 1; i <= sections.length; i++) {
    const same =
      i < sections.length &&
      sections[i].signature === sections[runStart].signature;
    if (same) continue;

    const runLen = i - runStart;
    if (runLen > FEED.MAX_FEED_SECTIONS) {
      const leader = sections[runStart];
      for (let j = runStart + FEED.MAX_FEED_SECTIONS; j < i; j++) {
        sections[j].collapsed = true;
        sections[j].collapsedInto = leader.sectionId;
      }
    }
    runStart = i;
  }
};

// M6: warm the page up before planning. Lazy content (IntersectionObserver,
// lazy hydration, infinite feeds) only mounts when its region approaches the
// viewport, so at `load` the document can be 90% absent. We step-scroll
// through the whole page — a single jump to the bottom would teleport past
// IO triggers without ever intersecting them.
//
// The loop stops when we reach the bottom AND the height has been stable for
// STABLE_ROUNDS checks. Any cap hit ENDS the scroll but does NOT fail the
// extraction — a truncated page is better than a failed request; the reason
// is recorded in `warnings` for page.json.
const warmUpScroll = async (page) => {
  const warnings = [];
  const deadline = Date.now() + WARMUP.MAX_WARMUP_TIME_MS;

  const initialHeight = await measurePageHeight(page);
  let steps = 0;
  let lastHeight = initialHeight;
  let stableRounds = 0;

  while (true) {
    await page.evaluate((step) => window.scrollBy(0, step), WARMUP.SCROLL_STEP);
    steps++;
    await page.waitForTimeout(WARMUP.STEP_DELAY_MS);

    const height = await measurePageHeight(page);
    const atBottom = await page.evaluate(
      () =>
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 4
    );

    stableRounds = height === lastHeight ? stableRounds + 1 : 0;
    lastHeight = height;

    if (atBottom && stableRounds >= WARMUP.STABLE_ROUNDS) break;
    if (height >= WARMUP.MAX_PAGE_HEIGHT) {
      warnings.push(`pageHeight hit MAX_PAGE_HEIGHT (${WARMUP.MAX_PAGE_HEIGHT}px)`);
      break;
    }
    if (steps >= WARMUP.MAX_SCROLL_STEPS) {
      warnings.push(`warm-up hit MAX_SCROLL_STEPS (${WARMUP.MAX_SCROLL_STEPS})`);
      break;
    }
    if (Date.now() > deadline) {
      warnings.push(`warm-up hit MAX_WARMUP_TIME (${WARMUP.MAX_WARMUP_TIME_MS}ms)`);
      break;
    }
  }

  // Back to the top: fixed elements return to their start position and the
  // final measurement sees a settled layout, not mid-scroll mutations.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(WARMUP.SETTLE_MS);

  const finalHeight = await measurePageHeight(page);
  if (finalHeight < WARMUP.MIN_REASONABLE_HEIGHT) {
    warnings.push(
      `suspiciously small finalHeight (${finalHeight}px) — page may be lazy-gated or blocked`
    );
  }

  return { initialHeight, finalHeight, steps, warnings };
};

// M2: screenshot one fixed window.
// IMPORTANT Playwright quirk: `clip` is relative to the VIEWPORT for a normal
// screenshot, but relative to the DOCUMENT when fullPage: true. We need
// document coordinates (section y=900 lives below the 844px viewport), so
// fullPage must be set — Playwright then captures beyond the viewport for us.
//
// Why scroll first? `loading="lazy"` images only fetch when near the visible
// viewport — feed items that mounted during warm-up after we scrolled past
// them would otherwise capture as grey skeletons. Clip coordinates are
// document-based, so scrolling for load purposes doesn't move the capture.
const captureSectionScreenshot = async (page, section, screenshotPath) => {
  await page.evaluate((y) => window.scrollTo(0, y), section.range.start);

  // wait until every <img> overlapping this window reports complete —
  // best-effort with a cap so a dead image can't stall the pipeline
  await page
    .waitForFunction(
      ({ top, bottom }) =>
        [...document.images].every((img) => {
          const r = img.getBoundingClientRect();
          const imgTop = r.top + window.scrollY;
          const imgBottom = r.bottom + window.scrollY;
          const overlaps = imgBottom > top && imgTop < bottom;
          return !overlaps || (img.complete && img.naturalWidth > 0);
        }),
      { top: section.range.start, bottom: section.range.end },
      { timeout: 3000 }
    )
    .catch(() => {});

  // Scroll back to top before capturing: in a captureBeyondViewport shot,
  // fixed/sticky elements render at the CURRENT scroll position — capturing
  // while scrolled down would paint the nav into every section. Loaded lazy
  // images stay loaded, so this doesn't undo the image trigger.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200); // let reveal animations/paint settle

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    clip: {
      x: 0,
      y: section.range.start,
      width: VIEWPORT.width,
      height: section.range.height, // already clamped to the page bottom
    },
  });
};

// M3: collect the HTML that produced a section's pixels.
// A section is a coordinate range, not an element — a window can cut across
// several siblings, so we find every element whose rendered box intersects
// the range, then compress that set down to "meaningful roots".
//
// The whole thing runs inside ONE page.evaluate (inside the browser). Doing
// boundingBox() per element over the Playwright protocol would mean a slow
// network round-trip for every node; in-page it's just memory access.
//
// Steps inside the browser:
//   1. getBoundingClientRect() → VIEWPORT-relative, so + scrollY = document
//      coordinates matching our section ranges.
//   2. Keep elements where elBottom > sectionTop && elTop < sectionBottom —
//      this also catches blocks that START BEFORE the window and flow into it.
//   3. Drop any element whose ancestor is already selected — the ancestor's
//      outerHTML contains it anyway.
//   4. If a root spans ~the whole page (body, #root wrappers), don't serialize
//      the entire DOM — descend into its intersecting children instead.
const extractSectionHtml = async (page, section) => {
  return page.evaluate(
    ({ sectionTop, sectionBottom }) => {
      const scrollY = window.scrollY;

      const boxOf = (el) => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top + scrollY,
          bottom: r.bottom + scrollY,
          height: r.height,
          width: r.width,
        };
      };

      const intersects = (box) =>
        box.height > 0 &&
        box.width > 0 &&
        box.bottom > sectionTop &&
        box.top < sectionBottom;

      // 1+2: every element that intersects the section
      const boxes = new Map(); // el -> document-coord box
      const hits = new Set();
      for (const el of document.querySelectorAll("*")) {
        const box = boxOf(el);
        if (intersects(box)) {
          boxes.set(el, box);
          hits.add(el);
        }
      }

      // 3: keep only elements with NO ancestor already in the set
      const hasSelectedAncestor = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (hits.has(p)) return true;
        }
        return false;
      };
      const topRoots = [...hits].filter((el) => !hasSelectedAncestor(el));

      // 4: unwrap containers that carry no boundary info for this window.
      // An element covering most of the window AND towering far beyond it is
      // a page wrapper (body, #root, app-shell divs) — serializing it would
      // drag the whole page DOM into every section file. Descend into its
      // intersecting children instead. A block merely CLIPPING the window edge
      // (e.g. a component whose top starts inside the range) is kept whole,
      // so its full markup is preserved for Phase 2.
      const windowHeight = sectionBottom - sectionTop;
      const isWrapper = (el) => {
        if (el === document.documentElement || el === document.body) return true;
        const b = boxes.get(el);
        const covered =
          Math.min(b.bottom, sectionBottom) - Math.max(b.top, sectionTop);
        return covered / windowHeight >= 0.8 && b.height > windowHeight * 1.5;
      };

      const roots = [];
      const queue = [...topRoots];
      while (queue.length) {
        const el = queue.shift();
        if (isWrapper(el)) {
          // children that don't intersect are simply not in `hits`
          for (const child of el.children) {
            if (hits.has(child)) queue.push(child);
          }
        } else {
          roots.push(el);
        }
      }

      // serialize top-to-bottom so the file reads like the rendered page
      roots.sort((a, b) => boxes.get(a).top - boxes.get(b).top);

      // A root's outerHTML drags along EVERY descendant — including <script>,
      // <style>, JSON-LD blobs, etc. that are invisible noise for component
      // identification. Clone the root, strip them from the clone, serialize.
      const STRIP_SELECTOR = "script,style,noscript,template,link,meta";
      const cleanOuterHtml = (el) => {
        const clone = el.cloneNode(true); // clone so the live DOM is untouched
        clone
          .querySelectorAll(STRIP_SELECTOR)
          .forEach((noise) => noise.remove());
        return clone.outerHTML;
      };

      // ── M4: signals.json — the compact "fingerprint" Phase 2's LLM reads ──
      // html.html is evidence; signals are the cheat-sheet. Sets dedupe
      // automatically (roots may share descendant values across sections).
      const signals = {
        ids: new Set(),
        classes: new Set(),
        testIds: new Set(),
        semanticTags: new Set(),
        visibleText: new Set(),
        links: [],
        imageCount: 0,
        svgCount: 0,
        buttonCount: 0,
        inputCount: 0,
        fixedElements: [],
      };

      // tags that hint at component type: nav+header ⇒ navbar, form ⇒ form…
      const SEMANTIC = new Set([
        "nav", "header", "footer", "main", "section", "article", "aside",
        "form", "h1", "h2", "h3", "h4", "h5", "h6", "button", "a", "img",
        "ul", "ol", "table", "video", "figure", "dialog",
      ]);
      const CAP = 50; // cap each list — real pages carry hundreds of classes
      const linkKeys = new Set();

      for (const root of roots) {
        for (const el of [root, ...root.querySelectorAll("*")]) {
          const tag = el.tagName.toLowerCase();

          if (el.id) signals.ids.add(el.id);
          if (signals.classes.size < CAP) {
            el.classList?.forEach((c) => signals.classes.add(c));
          }
          const testId = el.getAttribute("data-testid");
          if (testId) signals.testIds.add(testId);
          if (SEMANTIC.has(tag)) signals.semanticTags.add(tag);

          // only the element's OWN text nodes — collecting textContent per
          // element would repeat parent text for every nested child.
          // skip noise containers: a <style> inside a root would otherwise
          // leak raw CSS into visibleText.
          if (!el.matches(STRIP_SELECTOR)) {
            for (const node of el.childNodes) {
              if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                if (text) signals.visibleText.add(text.slice(0, 140));
              }
            }
          }

          if (tag === "a" && el.getAttribute("href")) {
            const key = el.getAttribute("href");
            if (!linkKeys.has(key)) {
              linkKeys.add(key);
              if (signals.links.length < 30) {
                signals.links.push({
                  href: key,
                  text: el.textContent.trim().slice(0, 80),
                });
              }
            }
          }

          if (tag === "img") signals.imageCount++;
          if (tag === "svg") signals.svgCount++;
          // submit/button inputs behave as buttons, not form fields
          if (el.matches('button,[role="button"],input[type="submit"],input[type="button"]')) {
            signals.buttonCount++;
          } else if (el.matches("input,textarea,select")) {
            signals.inputCount++;
          }
        }
      }

      // fixed/sticky: flag any element painted out of document flow. Its box
      // lands in the section where it renders (top of doc when scrollY=0), so
      // a persistent header shows up as `fixed` — Phase 2 knows it's chrome,
      // not content unique to this window.
      for (const el of hits) {
        const pos = getComputedStyle(el).position;
        if (
          (pos === "fixed" || pos === "sticky") &&
          signals.fixedElements.length < 20
        ) {
          const b = boxes.get(el);
          signals.fixedElements.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            testId: el.getAttribute("data-testid"),
            positioning: pos,
            top: Math.round(b.top),
            bottom: Math.round(b.bottom),
          });
        }
      }

      return {
        // a comment marker per root makes it easy to see where one block ends
        html: roots
          .map((el) => {
            const b = boxes.get(el);
            const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`;
            return `<!-- root: ${label} y=${Math.round(b.top)}-${Math.round(b.bottom)} -->\n${cleanOuterHtml(el)}`;
          })
          .join("\n\n"),
        signals: {
          ids: [...signals.ids].slice(0, CAP),
          classes: [...signals.classes].slice(0, CAP),
          testIds: [...signals.testIds].slice(0, CAP),
          semanticTags: [...signals.semanticTags].slice(0, CAP),
          visibleText: [...signals.visibleText].slice(0, CAP),
          links: signals.links,
          imageCount: signals.imageCount,
          svgCount: signals.svgCount,
          buttonCount: signals.buttonCount,
          inputCount: signals.inputCount,
          fixedElements: signals.fixedElements,
        },
        // small summary of what was chosen — handy for metadata/debugging
        roots: roots.map((el) => {
          const b = boxes.get(el);
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            testId: el.getAttribute("data-testid"),
            // structural fingerprint for feed-collapse detection
            cls: [...el.classList].sort().join("."),
            top: Math.round(b.top),
            bottom: Math.round(b.bottom),
          };
        }),
      };
    },
    {
      sectionTop: section.range.start,
      sectionBottom: section.range.end,
    }
  );
};

// Pipeline: open the page in a 400px mobile context → wait until it is
// rendered and stable → measure full document height → plan fixed windows →
// write output/ artifacts (screenshots + HTML now, signals/metadata next).
const extractPage = async (url) => {
  const browser = await chromium.launch(); // headless by default

  try {
    // A fresh context per request = no cookie/cache leakage between runs.
    // isMobile: true makes Chromium behave like a phone (touch, mobile UA,
    // meta-viewport handling) — required for a real 400px mobile render.
    const context = await browser.newContext({
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      deviceScaleFactor: 1, // 1 CSS px = 1 screenshot px — keeps clip math exact
      isMobile: true,
    });
    // Watch API calls from the very first navigation — feeds can fire their
    // first page during initial load, before warm-up scrolling even starts.
    const feeds = trackPaginatedFeeds(context);
    await feeds.register();

    const page = await context.newPage();

    // Readiness: 'load' = HTML + resources finished. We can't use
    // 'networkidle' as the goto condition — real sites keep connections alive
    // forever (analytics, chat widgets) so it would always time out.
    await page.goto(url, { waitUntil: "load", timeout: 30000 });

    // Still try networkidle — on hydration-heavy sites the real content only
    // exists once XHR bursts settle (this is what made Snitch render ~18k px).
    // Chatty sites may never idle: cap it and move on regardless.
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // Web fonts can swap in late and change layout/height — wait for them too.
    await page.evaluate(() => document.fonts?.ready);

    // M6: render lazy content, THEN measure/plan — height measured here is
    // the settled document height, not the initial shell.
    const warmUp = await warmUpScroll(page);
    const pageHeight = warmUp.finalHeight;
    const sections = planSections(pageHeight);

    // Fresh output/ for this run.
    resetOutputDir();

    // Pass 1 — in-page DOM work for every window. Signatures must be computed
    // before artifacts: a repeated-feed run collapses to its first few
    // sections, and screenshots are the expensive part we're trying to skip.
    const extracted = [];
    for (const section of sections) {
      const res = await extractSectionHtml(page, section);
      section.signature = sectionSignature(res.roots);
      extracted.push(res);
    }
    markCollapsedRuns(sections);
    // signature was internal working data for collapse detection — don't
    // leak it into page.json
    sections.forEach((s) => delete s.signature);

    // Pass 2 — write artifacts for real sections; collapsed ones only exist
    // as page.json entries pointing at the run leader.
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section.collapsed) continue;

      const prev = sections[i - 1] || null;
      const dir = ensureSectionDir(section.sectionId);

      const screenshotPath = path.join(dir, "screenshot.png");
      await captureSectionScreenshot(page, section, screenshotPath);

      const { html, roots, signals } = extracted[i];
      writeText(path.join(dir, "html.html"), html);
      writeJson(path.join(dir, "signals.json"), signals);

      // Paths stored relative to output/ so artifacts stay portable.
      section.artifacts = {
        screenshot: `${section.sectionId}/screenshot.png`,
        html: `${section.sectionId}/html.html`,
        signals: `${section.sectionId}/signals.json`,
        metadata: `${section.sectionId}/metadata.json`,
      };
      section.htmlRoots = roots; // which DOM roots produced html.html

      // M5: the section's identity card — what slice of the page it is, at
      // what viewport, and the chain back to the previous window. Phase 2 uses
      // overlapWithPrevious to avoid double-counting components that straddle
      // a boundary. We store only a REFERENCE to the previous section (§15),
      // never a copy of its screenshot/HTML.
      const metadata = {
        sectionId: section.sectionId,
        index: section.index,
        pageUrl: url,
        pageHeight,
        viewport: { ...VIEWPORT },
        range: section.range,
        previousSection: prev
          ? { sectionId: prev.sectionId, range: prev.range }
          : null,
        overlapWithPrevious: prev
          ? {
              // overlap region = where this window re-covers the tail of the
              // previous one: [thisStart, prevEnd]
              start: section.range.start,
              end: prev.range.end,
              height: prev.range.end - section.range.start,
            }
          : null,
        screenshot: section.artifacts.screenshot,
        html: section.artifacts.html,
        signals: section.artifacts.signals,
        extractionVersion: EXTRACTION_VERSION,
      };
      writeJson(path.join(dir, "metadata.json"), metadata);
    }

    // page.json = page-level manifest Phase 2 will read to enumerate sections.
    // warmUp diagnostics let anyone reconstruct how the page was rendered and
    // spot silent under-extraction (cap hits, suspiciously small heights).
    const pageJson = {
      url,
      viewport: { ...VIEWPORT },
      sectionHeight: SECTION_HEIGHT,
      sectionStep: SECTION_STEP,
      overlap: OVERLAP,
      pageHeight,
      sectionCount: sections.length,
      sections,
      warmUp: {
        initialHeight: warmUp.initialHeight,
        finalHeight: warmUp.finalHeight,
        scrollSteps: warmUp.steps,
      },
      // endpoints that repeated with only pagination differing — and got
      // their calls blocked after FEED.MAX_CALLS
      paginatedFeeds: feeds.summary(),
      warnings: warmUp.warnings,
      extractionVersion: EXTRACTION_VERSION,
    };
    writeJson(path.join(OUTPUT_ROOT, "page.json"), pageJson);

    return {
      ...pageJson,
      outputDir: OUTPUT_ROOT,
    };
  } finally {
    // finally guarantees the browser process dies even if anything above threw —
    // otherwise every failed request would leak a Chromium process.
    await browser.close();
  }
};

module.exports = {
  extractPage,
  planSections,
};
