/**
 * Secure WebSocket Server for Admin Dashboard Communication
 */
const WebSocket = require("ws");
const { getTokenManager } = require("./token-manager");
const { getAuditLogger } = require("./audit-logger");
const { getConfig } = require("./config-manager");
const logger = require("./logger");
const { TokenError } = require("./errors");

const config = getConfig();
const tokenManager = getTokenManager();
const auditLogger = getAuditLogger();

class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({
      server: httpServer,
      path: "/ws",
      verifyClient: (info) => {
        // Verify client connection - can add authentication here
        return true;
      },
    });

    this.clients = new Map(); // Map of client ID to WebSocket connection
    this.setupEventHandlers();
    logger.info("WebSocket server initialized", { path: "/ws" });
  }

  setupEventHandlers() {
    this.wss.on("connection", (ws, req) => {
      const clientId = this.generateClientId();
      const ipAddress = req.socket.remoteAddress || "unknown";

      ws.clientId = clientId;
      ws.isAuthenticated = false;
      ws.ipAddress = ipAddress;

      this.clients.set(clientId, ws);

      logger.info("WebSocket client connected", { clientId, ipAddress });

      // Send welcome message
      this.sendToClient(ws, {
        type: "connected",
        clientId,
        message: "Connected to admin dashboard server",
      });

      // Handle incoming messages
      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          logger.error("Error parsing WebSocket message", {
            error: error.message,
            clientId: ws.clientId,
          });
          this.sendError(ws, "Invalid message format");
        }
      });

      // Handle client disconnect
      ws.on("close", () => {
        this.clients.delete(clientId);
        logger.info("WebSocket client disconnected", { clientId });
      });

      // Handle errors
      ws.on("error", (error) => {
        logger.error("WebSocket error", {
          error: error.message,
          clientId: ws.clientId,
        });
      });
    });
  }

  /**
   * Generate unique client ID
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle incoming WebSocket messages
   */
  async handleMessage(ws, message) {
    const { type, data } = message;

    try {
      switch (type) {
        case "authenticate":
          await this.handleAuthenticate(ws, data);
          break;

        case "get_pending_requests":
          await this.handleGetPendingRequests(ws);
          break;

        case "approve_request":
          await this.handleApproveRequest(ws, data);
          break;

        case "deny_request":
          await this.handleDenyRequest(ws, data);
          break;

        case "ping":
          this.sendToClient(ws, { type: "pong" });
          break;

        default:
          this.sendError(ws, `Unknown message type: ${type}`);
      }
    } catch (error) {
      logger.error("Error handling WebSocket message", {
        error: error.message,
        type,
        clientId: ws.clientId,
      });
      this.sendError(ws, error.message);
    }
  }

  /**
   * Handle client authentication
   */
  async handleAuthenticate(ws, data) {
    const { password, twoFactorToken } = data;
    const { getAuthManager } = require("./auth-manager");
    const authManager = getAuthManager();

    try {
      await authManager.authenticate(password, twoFactorToken);
      ws.isAuthenticated = true;

      auditLogger.log("authentication_success", "admin", null, ws.ipAddress, {});

      this.sendToClient(ws, {
        type: "authenticated",
        message: "Authentication successful",
      });

      logger.info("WebSocket client authenticated", { clientId: ws.clientId });
    } catch (error) {
      auditLogger.log("authentication_failure", "admin", null, ws.ipAddress, {
        error: error.message,
      });

      this.sendError(ws, "Authentication failed: " + error.message);
    }
  }

  /**
   * Handle get pending requests
   */
  async handleGetPendingRequests(ws) {
    if (!ws.isAuthenticated) {
      this.sendError(ws, "Authentication required");
      return;
    }

    try {
      // Use requests manager (works in both contexts)
      const { getRequestsManager } = require("./requests-manager");
      const requestsManager = getRequestsManager();
      const requests = await requestsManager.loadRequests();
      const pendingRequests = requests.filter(
        (r) => r.status === "pending" || r.status === "approved"
      );

      this.sendToClient(ws, {
        type: "pending_requests",
        data: pendingRequests,
      });
    } catch (error) {
      logger.error("Error loading pending requests", {
        error: error.message,
        clientId: ws.clientId,
      });
      this.sendError(ws, "Failed to load requests");
    }
  }

  /**
   * Handle approve request
   */
  async handleApproveRequest(ws, data) {
    if (!ws.isAuthenticated) {
      this.sendError(ws, "Authentication required");
      return;
    }

    const { requestId, token } = data;

    try {
      // Validate token if provided
      if (token) {
        const tokenData = tokenManager.validateSecureToken(token);
        if (tokenData.requestId !== requestId) {
          throw new TokenError("Token does not match request ID");
        }
      }

      // Update request status using requests manager
      const { getRequestsManager } = require("./requests-manager");
      const requestsManager = getRequestsManager();
      await requestsManager.updateRequestStatus(requestId, "approved");

      auditLogger.log(
        "request_approved",
        "admin",
        requestId,
        ws.ipAddress,
        {}
      );

      // Notify all connected clients
      this.broadcast({
        type: "request_approved",
        data: { requestId },
      });

      this.sendToClient(ws, {
        type: "request_approved",
        data: { requestId },
        message: "Request approved successfully",
      });

      logger.info("Request approved via WebSocket", {
        requestId,
        clientId: ws.clientId,
      });
    } catch (error) {
      logger.error("Error approving request", {
        error: error.message,
        requestId,
        clientId: ws.clientId,
      });
      this.sendError(ws, error.message);
    }
  }

  /**
   * Handle deny request
   */
  async handleDenyRequest(ws, data) {
    if (!ws.isAuthenticated) {
      this.sendError(ws, "Authentication required");
      return;
    }

    const { requestId, token } = data;

    try {
      // Validate token if provided
      if (token) {
        const tokenData = tokenManager.validateSecureToken(token);
        if (tokenData.requestId !== requestId) {
          throw new TokenError("Token does not match request ID");
        }
      }

      // Update request status using requests manager
      const { getRequestsManager } = require("./requests-manager");
      const requestsManager = getRequestsManager();
      await requestsManager.updateRequestStatus(requestId, "denied");

      auditLogger.log("request_denied", "admin", requestId, ws.ipAddress, {});

      // Notify all connected clients
      this.broadcast({
        type: "request_denied",
        data: { requestId },
      });

      this.sendToClient(ws, {
        type: "request_denied",
        data: { requestId },
        message: "Request denied",
      });

      logger.info("Request denied via WebSocket", {
        requestId,
        clientId: ws.clientId,
      });
    } catch (error) {
      logger.error("Error denying request", {
        error: error.message,
        requestId,
        clientId: ws.clientId,
      });
      this.sendError(ws, error.message);
    }
  }

  /**
   * Send message to specific client
   */
  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error("Error sending message to client", {
          error: error.message,
          clientId: ws.clientId,
        });
      }
    }
  }

  /**
   * Send error message to client
   */
  sendError(ws, errorMessage) {
    this.sendToClient(ws, {
      type: "error",
      message: errorMessage,
    });
  }

  /**
   * Broadcast message to all authenticated clients
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    let sent = 0;

    for (const [clientId, ws] of this.clients.entries()) {
      if (ws.isAuthenticated && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
          sent++;
        } catch (error) {
          logger.error("Error broadcasting to client", {
            error: error.message,
            clientId,
          });
        }
      }
    }

    if (sent > 0) {
      logger.debug(`Broadcasted message to ${sent} clients`, { type: message.type });
    }
  }

  /**
   * Notify clients about new request
   */
  notifyNewRequest(request) {
    this.broadcast({
      type: "new_request",
      data: request,
    });
  }

  /**
   * Notify clients about request status update
   */
  notifyRequestStatusUpdate(requestId, status) {
    this.broadcast({
      type: "request_status_update",
      data: { requestId, status },
    });
  }

  /**
   * Get connected clients count
   */
  getConnectedClientsCount() {
    return Array.from(this.clients.values()).filter(
      (ws) => ws.readyState === WebSocket.OPEN
    ).length;
  }

  /**
   * Close WebSocket server
   */
  close() {
    // Close all client connections
    for (const [clientId, ws] of this.clients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }

    // Close server
    this.wss.close(() => {
      logger.info("WebSocket server closed");
    });
  }
}

module.exports = WebSocketServer;

