const fs = require("fs");
const path = require("path");
const { OUTPUT_DIR } = require("./extractorConfig");

// All extraction artifacts live under <project>/output/ and the directory is
// wiped at the start of every run — we keep exactly one run on disk.
const OUTPUT_ROOT = path.join(process.cwd(), OUTPUT_DIR);

// fs.*Sync is fine here: these are tiny writes, once per HTTP request,
// and they make the extraction flow easier to follow than async plumbing.
const resetOutputDir = () => {
  fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  return OUTPUT_ROOT;
};

// output/section-001/, output/section-002/, ...
const ensureSectionDir = (sectionId) => {
  const dir = path.join(OUTPUT_ROOT, sectionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const writeText = (filePath, content) => {
  fs.writeFileSync(filePath, content);
};

module.exports = {
  OUTPUT_ROOT,
  resetOutputDir,
  ensureSectionDir,
  writeJson,
  writeText,
};
