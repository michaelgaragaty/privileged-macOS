const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const path = require("path");
const { getTokenManager } = require("./token-manager");
const { getAuditLogger } = require("./audit-logger");
const { getConfig } = require("./config-manager");
const logger = require("./logger");

const config = getConfig();
const tokenManager = getTokenManager();
const auditLogger = getAuditLogger();

class ApprovalServer {
  constructor() {
    this.app = express();
    this.port = config.get("appServerPort");
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware
   */
  setupMiddleware() {
    // Parse JSON bodies
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Session middleware
    this.app.use(
      session({
        secret: config.get("sessionSecret"),
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: config.isProduction(),
          httpOnly: true,
          maxAge: config.get("sessionMaxAge"),
        },
      })
    );

    // Trust proxy in production (for rate limiting)
    if (config.isProduction()) {
      this.app.set("trust proxy", 1);
    }
  }

  /**
   * Setup rate limiters
   */
  getRateLimiters() {
    return {
      approval: rateLimit({
        windowMs: config.get("rateLimitWindow"),
        max: config.get("rateLimitMax"),
        message: "Too many requests. Please try again later.",
        standardHeaders: true,
        legacyHeaders: false,
      }),
      login: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 login attempts
        message: "Too many login attempts. Please try again later.",
        standardHeaders: true,
        legacyHeaders: false,
      }),
    };
  }

  /**
   * Escape HTML to prevent XSS attacks
   */
  escapeHtml(text) {
    if (typeof text !== "string") {
      return "";
    }
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
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
    const limiters = this.getRateLimiters();

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Approval endpoint with rate limiting and token validation
    this.app.get("/approve", limiters.approval, async (req, res) => {
      const token = req.query.token;
      const ipAddress = this.getClientIp(req);

      if (!token) {
        logger.warn("Approval attempt without token", { ipAddress });
        return res.send(this.getErrorPage("Token is required"));
      }

      try {
        // Validate token using token manager
        const tokenData = tokenManager.validateSecureToken(token);

        // Update request status
        if (tokenData.action === "approve") {
          await global.updateRequestStatus(tokenData.requestId, "approved");
          await auditLogger.logRequestApproval(
            tokenData.requestId,
            "token",
            ipAddress
          );
          logger.info("Request approved via token", {
            requestId: tokenData.requestId,
            ipAddress,
          });
          res.send(
            this.getSuccessPage(
              "✅ Request Approved",
              "The admin privilege request has been approved. The user will be notified and can activate their privileges."
            )
          );
        } else {
          await global.updateRequestStatus(tokenData.requestId, "denied");
          await auditLogger.logRequestDenial(
            tokenData.requestId,
            "token",
            ipAddress
          );
          logger.info("Request denied via token", {
            requestId: tokenData.requestId,
            ipAddress,
          });
          res.send(
            this.getSuccessPage(
              "❌ Request Denied",
              "The admin privilege request has been denied. The user will be notified."
            )
          );
        }
      } catch (error) {
        logger.error("Error processing approval", {
          error: error.message,
          ipAddress,
        });
        res.send(this.getErrorPage(error.message || "Error processing request"));
      }
    });

    // Serve static files for admin dashboard
    this.app.use("/admin", express.static(path.join(__dirname, "public")));
    
    // Redirect /admin to login
    this.app.get("/admin", (req, res) => {
      res.redirect("/admin/login.html");
    });

    // Admin dashboard routes will be added by admin-dashboard.js
  }

  /**
   * Get Express app instance (for admin dashboard to add routes)
   */
  getApp() {
    return this.app;
  }

  getSuccessPage(title, message) {
    const safeTitle = this.escapeHtml(title);
    const safeMessage = this.escapeHtml(message);
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .card {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
      max-width: 500px;
    }
    h1 {
      font-size: 32px;
      margin-bottom: 20px;
    }
    p {
      font-size: 16px;
      color: #666;
      line-height: 1.6;
    }
    .success { color: #28a745; }
    .error { color: #dc3545; }
  </style>
</head>
<body>
  <div class="card">
    <h1 class="success">${safeTitle}</h1>
    <p>${safeMessage}</p>
    <p style="margin-top: 30px; font-size: 14px; color: #999;">
      You can close this window.
    </p>
  </div>
</body>
</html>
    `;
  }

  getErrorPage(message) {
    const safeMessage = this.escapeHtml(message);
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .card {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
      max-width: 500px;
    }
    h1 {
      font-size: 32px;
      margin-bottom: 20px;
      color: #dc3545;
    }
    p {
      font-size: 16px;
      color: #666;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>❌ Error</h1>
    <p>${safeMessage}</p>
  </div>
</body>
</html>
    `;
  }

  start() {
    this.server = this.app.listen(this.port, () => {
      logger.info("Approval server started", {
        port: this.port,
        url: `http://localhost:${this.port}`,
      });

      // Initialize WebSocket server
      const WebSocketServer = require("./websocket-server");
      this.wsServer = new WebSocketServer(this.server);
    });
  }

  getWebSocketServer() {
    return this.wsServer;
  }

  close() {
    if (this.server) {
      this.server.close();
      logger.info("Approval server stopped");
    }
  }
}

module.exports = ApprovalServer;
