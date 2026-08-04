// Wraps an async route handler so rejected promises reach Express's error middleware
// instead of crashing the process (Section 3.2.8 - thin controllers, no repeated try/catch).
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
