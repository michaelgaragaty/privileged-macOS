/**
 * Authentication manager with password + optional 2FA/TOTP
 */
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const fs = require("fs").promises;
const path = require("path");
const { AuthError } = require("./errors");
const { getConfig } = require("./config-manager");
const logger = require("./logger");

const config = getConfig();

class AuthManager {
  constructor() {
    this.configFile = path.join(__dirname, "../config/admin-config.json");
    this.adminConfig = null;
    this.loadAdminConfig();
  }

  /**
   * Load admin configuration from file
   */
  async loadAdminConfig() {
    try {
      const data = await fs.readFile(this.configFile, "utf8");
      this.adminConfig = JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        // Config file doesn't exist, create default
        await this.initializeAdminConfig();
      } else {
        logger.error("Failed to load admin config", { error: error.message });
        throw error;
      }
    }
  }

  /**
   * Initialize admin configuration
   */
  async initializeAdminConfig() {
    const defaultPassword = config.get("adminPassword") || "admin";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    this.adminConfig = {
      passwordHash: hashedPassword,
      twoFactorEnabled: config.get("admin2FAEnabled") || false,
      twoFactorSecret: null,
      twoFactorBackupCodes: [],
    };

    await this.saveAdminConfig();
    logger.warn("Admin config initialized with default password. Please change it!");
  }

  /**
   * Save admin configuration to file
   */
  async saveAdminConfig() {
    try {
      const configDir = path.dirname(this.configFile);
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(this.configFile, JSON.stringify(this.adminConfig, null, 2), "utf8");
    } catch (error) {
      logger.error("Failed to save admin config", { error: error.message });
      throw error;
    }
  }

  /**
   * Verify password
   * @param {string} password - Plain text password
   * @returns {Promise<boolean>} True if password is correct
   */
  async verifyPassword(password) {
    if (!this.adminConfig || !this.adminConfig.passwordHash) {
      throw new AuthError("Admin configuration not found");
    }

    return await bcrypt.compare(password, this.adminConfig.passwordHash);
  }

  /**
   * Change admin password
   * @param {string} oldPassword - Current password
   * @param {string} newPassword - New password
   */
  async changePassword(oldPassword, newPassword) {
    const isValid = await this.verifyPassword(oldPassword);
    if (!isValid) {
      throw new AuthError("Current password is incorrect");
    }

    if (!newPassword || newPassword.length < 8) {
      throw new AuthError("New password must be at least 8 characters long");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    this.adminConfig.passwordHash = hashedPassword;
    await this.saveAdminConfig();

    logger.info("Admin password changed");
  }

  /**
   * Generate 2FA secret and QR code
   * @param {string} username - Username for QR code label
   * @returns {Promise<Object>} Secret and QR code data URL
   */
  async generate2FASecret(username = "Admin") {
    const secret = speakeasy.generateSecret({
      name: `macOS Privileges (${username})`,
      issuer: "macOS Privileges Manager",
    });

    this.adminConfig.twoFactorSecret = secret.base32;
    this.adminConfig.twoFactorEnabled = false; // Not enabled until verified
    await this.saveAdminConfig();

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    logger.info("2FA secret generated", { username });

    return {
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32,
    };
  }

  /**
   * Verify 2FA token
   * @param {string} token - TOTP token
   * @returns {Promise<boolean>} True if token is valid
   */
  async verify2FAToken(token) {
    if (!this.adminConfig || !this.adminConfig.twoFactorSecret) {
      throw new AuthError("2FA is not configured");
    }

    const verified = speakeasy.totp.verify({
      secret: this.adminConfig.twoFactorSecret,
      encoding: "base32",
      token,
      window: 2, // Allow 2 time steps (60 seconds) of tolerance
    });

    return verified;
  }

  /**
   * Enable 2FA (after verifying initial token)
   * @param {string} token - Initial TOTP token to verify
   */
  async enable2FA(token) {
    const isValid = await this.verify2FAToken(token);
    if (!isValid) {
      throw new AuthError("Invalid 2FA token");
    }

    this.adminConfig.twoFactorEnabled = true;
    await this.saveAdminConfig();

    logger.info("2FA enabled for admin");
  }

  /**
   * Disable 2FA
   * @param {string} password - Admin password for confirmation
   */
  async disable2FA(password) {
    const isValid = await this.verifyPassword(password);
    if (!isValid) {
      throw new AuthError("Password is incorrect");
    }

    this.adminConfig.twoFactorEnabled = false;
    this.adminConfig.twoFactorSecret = null;
    await this.saveAdminConfig();

    logger.info("2FA disabled for admin");
  }

  /**
   * Check if 2FA is enabled
   * @returns {boolean}
   */
  is2FAEnabled() {
    return this.adminConfig && this.adminConfig.twoFactorEnabled === true;
  }

  /**
   * Authenticate user with password and optional 2FA
   * @param {string} password - Password
   * @param {string} twoFactorToken - 2FA token (required if 2FA is enabled)
   * @returns {Promise<boolean>} True if authentication succeeds
   */
  async authenticate(password, twoFactorToken = null) {
    // Verify password
    const passwordValid = await this.verifyPassword(password);
    if (!passwordValid) {
      throw new AuthError("Invalid password");
    }

    // Check if 2FA is enabled
    if (this.is2FAEnabled()) {
      if (!twoFactorToken) {
        throw new AuthError("2FA token is required");
      }

      const tokenValid = await this.verify2FAToken(twoFactorToken);
      if (!tokenValid) {
        throw new AuthError("Invalid 2FA token");
      }
    }

    return true;
  }

  /**
   * Get 2FA setup status
   * @returns {Object} 2FA status information
   */
  get2FAStatus() {
    return {
      enabled: this.is2FAEnabled(),
      configured: !!(this.adminConfig && this.adminConfig.twoFactorSecret),
    };
  }
}

// Singleton instance
let instance = null;

function getAuthManager() {
  if (!instance) {
    instance = new AuthManager();
  }
  return instance;
}

module.exports = { AuthManager, getAuthManager };

