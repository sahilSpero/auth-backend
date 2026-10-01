const extractorService = require("./extractorService");
const { sendSuccess, sendError } = require("../../utils/response");

// POST /api/v1/extract  —  body: { "url": "https://..." }
// Synchronous: the request waits for the full extraction (browser launch +
// render can take ~5-30s) and returns the result summary.
const extract = async (req, res, next) => {
  try {
    const { url } = req.body || {};

    // Validate early — launching a browser for a bad URL wastes seconds.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return sendError(res, "A valid url is required", 400);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return sendError(res, "Only http/https urls are supported", 400);
    }

    const result = await extractorService.extractPage(parsed.toString());
    sendSuccess(res, result, "Page extracted successfully");
  } catch (error) {
    sendError(res, error.message);
  }
};

module.exports = { extract };
