const { ApiError } = require('./errorHandler');

// Role-permission-user separation per the RBAC model (Sandhu et al., 1996) discussed in
// Section 2.7: the role lives in the verified JWT claim, not anything the client can set,
// so this middleware cannot be bypassed by a direct call to the endpoint.
function roleGuard(...allowedRoles) {
  return function guard(req, res, next) {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'You do not have permission to perform this action'));
    }
    return next();
  };
}

module.exports = { roleGuard };
