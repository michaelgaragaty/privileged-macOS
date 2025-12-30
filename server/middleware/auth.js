/**
 * Authentication middleware for admin routes
 */
const { AuthError } = require("../errors");
const logger = require("../logger");

/**
 * Middleware to check if user is authenticated
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }

  // If it's an API request, return JSON error
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Otherwise redirect to login
  return res.redirect("/admin/login.html");
}

/**
 * Middleware to check if user is NOT authenticated (for login page)
 */
function requireGuest(req, res, next) {
  if (req.session && req.session.authenticated) {
    return res.redirect("/admin/dashboard.html");
  }
  return next();
}

module.exports = { requireAuth, requireGuest };
