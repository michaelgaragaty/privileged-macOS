/**
 * Custom error classes for the application
 */

class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
    this.code = "VALIDATION_ERROR";
  }
}

class PrivilegeError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrivilegeError";
    this.code = "PRIVILEGE_ERROR";
  }
}

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
    this.code = "AUTH_ERROR";
  }
}

class TokenError extends Error {
  constructor(message) {
    super(message);
    this.name = "TokenError";
    this.code = "TOKEN_ERROR";
  }
}

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
    this.code = "CONFIG_ERROR";
  }
}

module.exports = {
  ValidationError,
  PrivilegeError,
  AuthError,
  TokenError,
  ConfigError,
};

