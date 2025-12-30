/**
 * Audit logging system for tracking all security-relevant actions
 */
const fs = require("fs").promises;
const path = require("path");
const logger = require("./logger");

class AuditLogger {
  constructor() {
    this.auditLogFile = path.join(__dirname, "../logs/audit.log");
    this.ensureLogFile();
  }

  /**
   * Ensure audit log file exists
   */
  async ensureLogFile() {
    const logsDir = path.dirname(this.auditLogFile);
    try {
      await fs.mkdir(logsDir, { recursive: true });
    } catch (error) {
      logger.error("Failed to create logs directory", { error: error.message });
    }
  }

  /**
   * Log an audit event
   * @param {Object} event - Event data
   * @param {string} event.action - Action type (e.g., 'privilege_granted', 'request_approved')
   * @param {string} event.user - Username
   * @param {string} event.requestId - Request ID (if applicable)
   * @param {string} event.ipAddress - IP address
   * @param {Object} event.details - Additional details
   */
  async log(event) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      action: event.action,
      user: event.user || "system",
      requestId: event.requestId || null,
      ipAddress: event.ipAddress || "unknown",
      details: event.details || {},
    };

    const logLine = JSON.stringify(auditEntry) + "\n";

    try {
      await fs.appendFile(this.auditLogFile, logLine, "utf8");
      logger.debug("Audit log entry written", auditEntry);
    } catch (error) {
      logger.error("Failed to write audit log", { error: error.message, entry: auditEntry });
    }
  }

  /**
   * Read audit logs with optional filtering
   * @param {Object} filters - Filter options
   * @param {Date} filters.startDate - Start date
   * @param {Date} filters.endDate - End date
   * @param {string} filters.user - Username filter
   * @param {string} filters.action - Action type filter
   * @param {number} filters.limit - Maximum number of entries to return
   * @returns {Promise<Array>} Array of audit log entries
   */
  async readLogs(filters = {}) {
    try {
      const data = await fs.readFile(this.auditLogFile, "utf8");
      const lines = data.trim().split("\n").filter((line) => line.length > 0);
      let entries = lines.map((line) => JSON.parse(line));

      // Apply filters
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        entries = entries.filter((entry) => new Date(entry.timestamp) >= start);
      }

      if (filters.endDate) {
        const end = new Date(filters.endDate);
        entries = entries.filter((entry) => new Date(entry.timestamp) <= end);
      }

      if (filters.user) {
        entries = entries.filter((entry) => entry.user === filters.user);
      }

      if (filters.action) {
        entries = entries.filter((entry) => entry.action === filters.action);
      }

      // Sort by timestamp (newest first)
      entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Apply limit
      if (filters.limit) {
        entries = entries.slice(0, filters.limit);
      }

      return entries;
    } catch (error) {
      if (error.code === "ENOENT") {
        // Log file doesn't exist yet
        return [];
      }
      logger.error("Failed to read audit logs", { error: error.message });
      throw error;
    }
  }

  /**
   * Log privilege grant
   */
  async logPrivilegeGrant(requestId, username, ipAddress, details = {}) {
    await this.log({
      action: "privilege_granted",
      user: username,
      requestId,
      ipAddress,
      details,
    });
  }

  /**
   * Log privilege revocation
   */
  async logPrivilegeRevocation(requestId, username, reason = "expired") {
    await this.log({
      action: "privilege_revoked",
      user: username,
      requestId,
      details: { reason },
    });
  }

  /**
   * Log request approval
   */
  async logRequestApproval(requestId, approver, ipAddress, details = {}) {
    await this.log({
      action: "request_approved",
      user: approver,
      requestId,
      ipAddress,
      details,
    });
  }

  /**
   * Log request denial
   */
  async logRequestDenial(requestId, denier, ipAddress, reason = null) {
    await this.log({
      action: "request_denied",
      user: denier,
      requestId,
      ipAddress,
      details: { reason },
    });
  }

  /**
   * Log request submission
   */
  async logRequestSubmission(requestId, username, details = {}) {
    await this.log({
      action: "request_submitted",
      user: username,
      requestId,
      details,
    });
  }

  /**
   * Log authentication event
   */
  async logAuthentication(username, success, ipAddress, details = {}) {
    await this.log({
      action: success ? "authentication_success" : "authentication_failure",
      user: username,
      ipAddress,
      details,
    });
  }
}

// Singleton instance
let instance = null;

function getAuditLogger() {
  if (!instance) {
    instance = new AuditLogger();
  }
  return instance;
}

module.exports = { AuditLogger, getAuditLogger };

