/**
 * Admin Dashboard Backend
 */
const { getAuthManager } = require("./auth-manager");
const { getAuditLogger } = require("./audit-logger");
const { getTokenManager } = require("./token-manager");
const { requireAuth, requireGuest } = require("./middleware/auth");
const { getConfig } = require("./config-manager");
const logger = require("./logger");
const { AuthError } = require("./errors");

const authManager = getAuthManager();
const auditLogger = getAuditLogger();
const tokenManager = getTokenManager();
const config = getConfig();

class AdminDashboard {
  constructor(approvalServer) {
    this.app = approvalServer.getApp();
    this.setupRoutes();
  }

  /**
   * Get client IP address
   */
  getClientIp(req) {
    return (
      req.ip ||
      req.connection.remoteAddress ||
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      "unknown"
    );
  }

  /**
   * Setup routes
   */
  setupRoutes() {
    // API Routes
    const apiRouter = require("express").Router();

    // Login endpoint
    apiRouter.post("/login", requireGuest, async (req, res) => {
      const { password, twoFactorToken } = req.body;
      const ipAddress = this.getClientIp(req);

      try {
        await authManager.authenticate(password, twoFactorToken);

        // Create session
        req.session.authenticated = true;
        req.session.loginTime = Date.now();

        await auditLogger.logAuthentication("admin", true, ipAddress);

        logger.info("Admin login successful", { ipAddress });

        res.json({ success: true, message: "Login successful" });
      } catch (error) {
        await auditLogger.logAuthentication("admin", false, ipAddress, {
          error: error.message,
        });

        logger.warn("Admin login failed", { ipAddress, error: error.message });

        res.status(401).json({
          success: false,
          error: error.message || "Invalid credentials",
        });
      }
    });

    // Logout endpoint
    apiRouter.post("/logout", requireAuth, async (req, res) => {
      req.session.destroy((err) => {
        if (err) {
          logger.error("Error destroying session", { error: err.message });
          return res.status(500).json({ error: "Logout failed" });
        }
        res.json({ success: true, message: "Logged out successfully" });
      });
    });

    // Get pending requests
    apiRouter.get("/requests/pending", requireAuth, async (req, res) => {
      try {
        const { getRequestsManager } = require("./requests-manager");
        const requestsManager = getRequestsManager();
        const requests = await requestsManager.loadRequests();
        const pending = requests.filter(
          (r) => r.status === "pending" || r.status === "approved"
        );
        res.json({ success: true, requests: pending });
      } catch (error) {
        logger.error("Error fetching pending requests", { error: error.message });
        res.status(500).json({ error: "Failed to fetch requests" });
      }
    });

    // Get all requests
    apiRouter.get("/requests", requireAuth, async (req, res) => {
      try {
        const { getRequestsManager } = require("./requests-manager");
        const requestsManager = getRequestsManager();
        const requests = await requestsManager.loadRequests();
        res.json({ success: true, requests });
      } catch (error) {
        logger.error("Error fetching requests", { error: error.message });
        res.status(500).json({ error: "Failed to fetch requests" });
      }
    });

    // Approve request
    apiRouter.post("/requests/:requestId/approve", requireAuth, async (req, res) => {
      const { requestId } = req.params;
      const ipAddress = this.getClientIp(req);

      try {
        const { getRequestsManager } = require("./requests-manager");
        const requestsManager = getRequestsManager();
        await requestsManager.updateRequestStatus(requestId, "approved");
        await auditLogger.logRequestApproval(requestId, req.session.user || "admin", ipAddress);

        logger.info("Request approved via dashboard", { requestId, ipAddress });

        res.json({ success: true, message: "Request approved" });
      } catch (error) {
        logger.error("Error approving request", { error: error.message, requestId });
        res.status(500).json({ error: "Failed to approve request" });
      }
    });

    // Deny request
    apiRouter.post("/requests/:requestId/deny", requireAuth, async (req, res) => {
      const { requestId } = req.params;
      const { reason } = req.body;
      const ipAddress = this.getClientIp(req);

      try {
        const { getRequestsManager } = require("./requests-manager");
        const requestsManager = getRequestsManager();
        await requestsManager.updateRequestStatus(requestId, "denied");
        await auditLogger.logRequestDenial(requestId, req.session.user || "admin", ipAddress, reason);

        logger.info("Request denied via dashboard", { requestId, ipAddress, reason });

        res.json({ success: true, message: "Request denied" });
      } catch (error) {
        logger.error("Error denying request", { error: error.message, requestId });
        res.status(500).json({ error: "Failed to deny request" });
      }
    });

    // Get audit logs
    apiRouter.get("/audit-logs", requireAuth, async (req, res) => {
      try {
        const { startDate, endDate, user, action, limit } = req.query;
        const filters = {};

        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;
        if (user) filters.user = user;
        if (action) filters.action = action;
        if (limit) filters.limit = parseInt(limit, 10);

        const logs = await auditLogger.readLogs(filters);
        res.json({ success: true, logs });
      } catch (error) {
        logger.error("Error fetching audit logs", { error: error.message });
        res.status(500).json({ error: "Failed to fetch audit logs" });
      }
    });

    // Get 2FA status
    apiRouter.get("/2fa/status", requireAuth, async (req, res) => {
      try {
        const status = authManager.get2FAStatus();
        res.json({ success: true, ...status });
      } catch (error) {
        res.status(500).json({ error: "Failed to get 2FA status" });
      }
    });

    // Generate 2FA secret
    apiRouter.post("/2fa/generate", requireAuth, async (req, res) => {
      try {
        const { username } = req.body;
        const secretData = await authManager.generate2FASecret(username || "Admin");
        res.json({ success: true, ...secretData });
      } catch (error) {
        logger.error("Error generating 2FA secret", { error: error.message });
        res.status(500).json({ error: "Failed to generate 2FA secret" });
      }
    });

    // Enable 2FA
    apiRouter.post("/2fa/enable", requireAuth, async (req, res) => {
      const { token } = req.body;
      try {
        await authManager.enable2FA(token);
        res.json({ success: true, message: "2FA enabled successfully" });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Disable 2FA
    apiRouter.post("/2fa/disable", requireAuth, async (req, res) => {
      const { password } = req.body;
      try {
        await authManager.disable2FA(password);
        res.json({ success: true, message: "2FA disabled successfully" });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Change password
    apiRouter.post("/change-password", requireAuth, async (req, res) => {
      const { oldPassword, newPassword } = req.body;
      try {
        await authManager.changePassword(oldPassword, newPassword);
        res.json({ success: true, message: "Password changed successfully" });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Mount API routes
    this.app.use("/api/admin", apiRouter);
  }
}

module.exports = AdminDashboard;

