/**
 * Centralized configuration management
 */
const { ConfigError } = require("./errors");

class ConfigManager {
  constructor() {
    this.config = {};
    this.loadConfig();
  }

  loadConfig() {
    // Load environment variables
    this.config = {
      // Server configuration
      appServerUrl: process.env.APP_SERVER_URL || "http://localhost:3000",
      appServerPort: parseInt(process.env.APP_SERVER_PORT || "3000", 10),

      // SMTP configuration
      smtp: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        secure: process.env.SMTP_SECURE === "true",
        from: process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@example.com",
      },

      // Admin configuration
      adminEmail: process.env.ADMIN_EMAIL || "michaelga@brightdata.com",

      // Token configuration
      tokenSecret: process.env.TOKEN_SECRET,
      tokenExpiration: parseInt(process.env.TOKEN_EXPIRATION_MINUTES || "15", 10) * 60 * 1000,

      // Webhook configuration
      webhookUrl: process.env.MAKE_WEBHOOK_URL,

      // Admin authentication
      adminPassword: process.env.ADMIN_PASSWORD,
      admin2FAEnabled: process.env.ADMIN_2FA_ENABLED === "true",

      // Session configuration
      sessionSecret: process.env.SESSION_SECRET || process.env.TOKEN_SECRET,
      sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || "86400000", 10), // 24 hours default

      // Rate limiting
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 minutes
      rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "10", 10),

      // Environment
      nodeEnv: process.env.NODE_ENV || "development",
    };
  }

  get(key) {
    return this.config[key];
  }

  validate() {
    const errors = [];

    // Validate SMTP configuration
    if (!this.config.smtp.host) {
      errors.push("SMTP_HOST is required");
    }
    if (!this.config.smtp.user) {
      errors.push("SMTP_USER is required");
    }
    if (!this.config.smtp.pass) {
      errors.push("SMTP_PASS is required");
    }
    if (isNaN(this.config.smtp.port)) {
      errors.push("SMTP_PORT must be a number");
    }

    // Validate admin email
    if (this.config.adminEmail && !this.isValidEmail(this.config.adminEmail)) {
      errors.push("ADMIN_EMAIL must be a valid email address");
    }

    // Validate token secret
    if (!this.config.tokenSecret) {
      errors.push("TOKEN_SECRET is required for secure token generation");
    } else if (this.config.tokenSecret.length < 32) {
      errors.push("TOKEN_SECRET must be at least 32 characters long");
    }

    if (errors.length > 0) {
      throw new ConfigError(`Configuration validation failed: ${errors.join(", ")}`);
    }
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  isProduction() {
    return this.config.nodeEnv === "production";
  }

  isDevelopment() {
    return this.config.nodeEnv === "development";
  }
}

// Singleton instance
let instance = null;

function getConfig() {
  if (!instance) {
    instance = new ConfigManager();
  }
  return instance;
}

module.exports = { ConfigManager, getConfig };

