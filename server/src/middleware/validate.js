const { validationResult } = require('express-validator');
const { ApiError } = require('./errorHandler');

// Runs after an array of express-validator checks; turns the first failure into a 400
// with a user-understandable message (NFR08) instead of letting bad input reach a service.
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array()[0];
    return next(new ApiError(400, first.msg, errors.array()));
  }
  return next();
}

module.exports = { validate };
