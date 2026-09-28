// Every API response looks identical — no inconsistency across routes
// { success: true,  data: {...}, message: "..." }
// { success: false, data: null,  message: "Something went wrong" }

const sendSuccess = (res, data, message = "Success", statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const sendError = (res, message = "Something went wrong", statusCode = 500) => {
  return res.status(statusCode).json({
    success: false,
    message, 
    data: null,
  });
};

module.exports = { sendSuccess, sendError };