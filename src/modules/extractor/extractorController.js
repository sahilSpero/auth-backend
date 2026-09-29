const extractorService = require("./extractorService");
const { sendSuccess, sendError } = require("../../utils/response");

const extract = async (req, res, next) => {
  try {
    const { url } = req.body || {};

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
