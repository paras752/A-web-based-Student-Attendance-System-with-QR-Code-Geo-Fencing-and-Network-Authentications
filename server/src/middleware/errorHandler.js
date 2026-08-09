// Central error handler (NFR08: user-understandable messages, no stack traces to the client).
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function notFoundHandler(req, res, next) {
  next(new ApiError(404, 'Resource not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({
    error: {
      // Machine-readable reason where the thrower set one (see fail() in attendance.service).
      // Emitted separately from the message so a client can branch on the outcome without
      // pattern-matching human-readable text, which silently stops matching when it is reworded.
      code: err.reason,
      message: err.expose === false ? 'Internal server error' : err.message || 'Internal server error',
      details: err.details,
    },
  });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
