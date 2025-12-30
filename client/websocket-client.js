/**
 * WebSocket Client for connecting to Admin Dashboard
 */
const WebSocket = require("ws");
const { getConfig } = require("../server/config-manager");
const logger = require("../server/logger");

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.reconnectInterval = 5000; // 5 seconds
    this.reconnectTimer = null;
    this.isConnecting = false;
    this.messageHandlers = new Map();
    this.config = getConfig();
    this.serverUrl = this.config.get("dashboardWebSocketUrl") || "ws://localhost:3000/ws";
  }

  /**
   * Connect to the dashboard WebSocket server
   */
  connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    logger.info("Connecting to admin dashboard WebSocket", { url: this.serverUrl });

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.on("open", () => {
        this.isConnecting = false;
        logger.info("Connected to admin dashboard WebSocket");
        this.clearReconnectTimer();
      });

      this.ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.error("Error parsing WebSocket message", {
            error: error.message,
          });
        }
      });

      this.ws.on("close", () => {
        this.isConnecting = false;
        logger.warn("Disconnected from admin dashboard WebSocket");
        this.scheduleReconnect();
      });

      this.ws.on("error", (error) => {
        this.isConnecting = false;
        logger.error("WebSocket error", { error: error.message });
        this.scheduleReconnect();
      });
    } catch (error) {
      this.isConnecting = false;
      logger.error("Error creating WebSocket connection", {
        error: error.message,
      });
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming messages from dashboard
   */
  handleMessage(message) {
    const { type, data } = message;

    // Call registered handlers
    const handlers = this.messageHandlers.get(type) || [];
    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        logger.error("Error in WebSocket message handler", {
          error: error.message,
          type,
        });
      }
    });

    // Handle specific message types
    switch (type) {
      case "pong":
        // Heartbeat response
        break;
      case "request_received":
        logger.info("Request acknowledged by dashboard", {
          requestId: data?.requestId,
          message: data?.message,
        });
        break;
      case "request_approved":
        logger.info("Request approved via WebSocket", {
          requestId: data?.requestId,
        });
        break;
      case "request_denied":
        logger.info("Request denied via WebSocket", {
          requestId: data?.requestId,
        });
        break;
      case "request_status_update":
        logger.info("Request status updated via WebSocket", {
          requestId: data?.requestId,
          status: data?.status,
        });
        break;
      default:
        logger.debug("Received WebSocket message", { type });
    }
  }

  /**
   * Send message to dashboard
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn("WebSocket not connected, cannot send message", {
        type: message.type,
      });
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error("Error sending WebSocket message", {
        error: error.message,
        type: message.type,
      });
      return false;
    }
  }

  /**
   * Notify dashboard about new request
   */
  notifyNewRequest(request) {
    return this.send({
      type: "new_request",
      data: {
        id: request.id,
        username: request.username,
        fullName: request.fullName,
        duration: request.duration,
        reason: request.reason,
        timestamp: request.timestamp,
        status: request.status,
        approvalToken: request.approvalToken,
        denyToken: request.denyToken,
      },
    });
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      connected: this.isConnected(),
      url: this.serverUrl,
    };
  }

  /**
   * Register message handler
   */
  on(messageType, handler) {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, []);
    }
    this.messageHandlers.get(messageType).push(handler);
  }

  /**
   * Remove message handler
   */
  off(messageType, handler) {
    const handlers = this.messageHandlers.get(messageType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Schedule reconnection
   */
  scheduleReconnect() {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      logger.info("Attempting to reconnect to admin dashboard...");
      this.connect();
    }, this.reconnectInterval);
  }

  /**
   * Clear reconnect timer
   */
  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Disconnect from dashboard
   */
  disconnect() {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send ping for heartbeat
   */
  ping() {
    if (this.isConnected()) {
      this.send({ type: "ping" });
    }
  }
}

// Singleton instance
let instance = null;

function getWebSocketClient() {
  if (!instance) {
    instance = new WebSocketClient();
  }
  return instance;
}

module.exports = { WebSocketClient, getWebSocketClient };

