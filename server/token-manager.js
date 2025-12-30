/**
 * HMAC-signed token management system
 */
const crypto = require("crypto");
const { TokenError } = require("./errors");
const { getConfig } = require("./config-manager");
const logger = require("./logger");

const config = getConfig();

class TokenManager {
  constructor() {
    this.tokens = new Map(); // In-memory token storage
    this.cleanupInterval = null;
    this.startCleanupJob();
  }

  /**
   * Generate a secure HMAC-signed token
   * @param {string} requestId - Request ID
   * @param {string} action - Action type ('approve' or 'deny')
   * @returns {Object} Token object with token string and expiration
   */
  generateSecureToken(requestId, action) {
    if (!requestId || !action) {
      throw new TokenError("Request ID and action are required");
    }

    if (!["approve", "deny"].includes(action)) {
      throw new TokenError("Action must be 'approve' or 'deny'");
    }

    const secret = config.get("tokenSecret");
    if (!secret) {
      throw new TokenError("TOKEN_SECRET is not configured");
    }

    const expiresAt = Date.now() + config.get("tokenExpiration");
    const payload = `${requestId}:${action}:${expiresAt}`;

    // Generate HMAC signature
    const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    // Create token: base64url encode (payload:hmac)
    const tokenString = Buffer.from(`${payload}:${hmac}`).toString("base64url");

    // Store token metadata
    const tokenData = {
      requestId,
      action,
      expiresAt,
      createdAt: Date.now(),
      used: false,
    };

    this.tokens.set(tokenString, tokenData);

    logger.debug("Token generated", { requestId, action, expiresAt: new Date(expiresAt) });

    return {
      token: tokenString,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /**
   * Validate and consume a token
   * @param {string} token - Token string to validate
   * @returns {Object} Token data if valid
   * @throws {TokenError} If token is invalid or expired
   */
  validateSecureToken(token) {
    if (!token || typeof token !== "string") {
      throw new TokenError("Token is required");
    }

    // Check if token exists in storage
    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      throw new TokenError("Invalid token");
    }

    // Check if token was already used
    if (tokenData.used) {
      throw new TokenError("Token has already been used");
    }

    // Check expiration
    if (Date.now() > tokenData.expiresAt) {
      this.tokens.delete(token);
      throw new TokenError("Token has expired");
    }

    // Verify HMAC signature
    try {
      const decoded = Buffer.from(token, "base64url").toString("utf-8");
      const [requestId, action, expiresAt, receivedHmac] = decoded.split(":");

      // Reconstruct payload
      const payload = `${requestId}:${action}:${expiresAt}`;

      // Verify HMAC
      const secret = config.get("tokenSecret");
      const expectedHmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");

      if (receivedHmac !== expectedHmac) {
        this.tokens.delete(token);
        throw new TokenError("Invalid token signature");
      }

      // Verify token data matches
      if (
        requestId !== tokenData.requestId ||
        action !== tokenData.action ||
        parseInt(expiresAt, 10) !== tokenData.expiresAt
      ) {
        this.tokens.delete(token);
        throw new TokenError("Token data mismatch");
      }
    } catch (error) {
      if (error instanceof TokenError) {
        throw error;
      }
      throw new TokenError("Invalid token format");
    }

    // Mark token as used
    tokenData.used = true;
    this.tokens.set(token, tokenData);

    logger.info("Token validated and consumed", { requestId: tokenData.requestId, action: tokenData.action });

    return {
      requestId: tokenData.requestId,
      action: tokenData.action,
    };
  }

  /**
   * Start periodic cleanup of expired tokens
   */
  startCleanupJob() {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 5 * 60 * 1000);
  }

  /**
   * Remove expired tokens from storage
   */
  cleanupExpiredTokens() {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, data] of this.tokens.entries()) {
      if (now > data.expiresAt) {
        this.tokens.delete(token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired tokens`);
    }
  }

  /**
   * Stop cleanup job
   */
  stopCleanupJob() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get token statistics
   */
  getStats() {
    const now = Date.now();
    let active = 0;
    let expired = 0;
    let used = 0;

    for (const data of this.tokens.values()) {
      if (data.used) {
        used++;
      } else if (now > data.expiresAt) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: this.tokens.size,
      active,
      expired,
      used,
    };
  }
}

// Singleton instance
let instance = null;

function getTokenManager() {
  if (!instance) {
    instance = new TokenManager();
  }
  return instance;
}

module.exports = { TokenManager, getTokenManager };

