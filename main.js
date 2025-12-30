const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Notification,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const os = require("os");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const lockfile = require("proper-lockfile");

// Load environment variables FIRST - before any other modules that might use them
// Use explicit path to ensure .env is found
const envPath = path.join(__dirname, ".env");
const dotenvResult = require("dotenv").config({ path: envPath });
if (dotenvResult.error) {
  console.warn(
    `Warning: Could not load .env file from ${envPath}:`,
    dotenvResult.error.message
  );
} else {
  console.log(`✓ Loaded .env file from ${envPath}`);
}

// Now require logger (which depends on config-manager, which needs env vars)
const logger = require("./server/logger");

let mainWindow;

// Validate environment variables
function validateEnvironment() {
  const errors = [];
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    errors.push(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  // Validate SMTP_PORT is a number
  if (process.env.SMTP_PORT && isNaN(parseInt(process.env.SMTP_PORT, 10))) {
    errors.push("SMTP_PORT must be a number");
  }

  // Validate ADMIN_EMAIL format if provided
  if (process.env.ADMIN_EMAIL) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(process.env.ADMIN_EMAIL)) {
      errors.push("ADMIN_EMAIL must be a valid email address");
    }
  }

  // Validate TOKEN_SECRET if provided
  if (process.env.TOKEN_SECRET && process.env.TOKEN_SECRET.length < 32) {
    errors.push("TOKEN_SECRET must be at least 32 characters long");
  }

  if (errors.length > 0) {
    const errorMessage = errors.join("\n");
    logger.error("Environment validation failed", { errors });
    if (app && !app.isReady()) {
      dialog.showErrorBox("Configuration Error", errorMessage);
      app.quit();
    } else {
      throw new Error(errorMessage);
    }
  }
}

const APP_SERVER_URL = process.env.APP_SERVER_URL || "http://localhost:3000";
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT || "587";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "no-reply@example.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "michaelga@brightdata.com";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f5f5f5",
  });

  mainWindow.loadFile("index.html");

  // Open DevTools in development
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }
}

// Restore active privileges and their timers on app startup
async function restoreActivePrivileges() {
  try {
    const requests = await loadRequests();
    const now = Date.now();

    for (const request of requests) {
      if (request.status === "active" && request.expiresAt) {
        const expiresAt = new Date(request.expiresAt).getTime();
        const remaining = expiresAt - now;

        if (remaining > 0) {
          // Restore timer
          setTimeout(async () => {
            try {
              const PrivilegeHelper = require("./helper/privilege-helper");
              const helper = new PrivilegeHelper();
              await helper.removeUserFromAdminGroup(request.username);
              await updateRequestStatus(request.id, "expired");
              if (mainWindow) {
                mainWindow.webContents.send("privileges-expired");
              }
            } catch (error) {
              logger.error("Error removing privileges on expiration", {
                error: error.message,
                requestId: request.id,
              });
            }
          }, remaining);
          logger.info(`Restored timer for request ${request.id}`, {
            expiresIn: Math.round(remaining / 1000),
          });
        } else {
          // Already expired, remove immediately
          try {
            const PrivilegeHelper = require("./helper/privilege-helper");
            const helper = new PrivilegeHelper();
            await helper.removeUserFromAdminGroup(request.username);
            await updateRequestStatus(request.id, "expired");
          } catch (error) {
            logger.error("Error removing expired privileges", {
              error: error.message,
              requestId: request.id,
            });
          }
        }
      }
    }
  } catch (error) {
    logger.error("Error restoring active privileges", {
      error: error.message,
      stack: error.stack,
    });
  }
}

app.whenReady().then(async () => {
  try {
    // Initialize and validate configuration
    const { getConfig } = require("./server/config-manager");
    const config = getConfig();
    config.validate();

    // Also run legacy validation
    validateEnvironment();
  } catch (error) {
    logger.error("Environment validation failed", { error: error.message });
    dialog.showErrorBox("Configuration Error", error.message);
    app.quit();
    return;
  }

  createWindow();
  connectToDashboard();
  await restoreActivePrivileges();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  // Disconnect WebSocket client
  if (global.wsClient) {
    global.wsClient.disconnect();
  }
});

// Connect to admin dashboard via WebSocket
function connectToDashboard() {
  const { getWebSocketClient } = require("./client/websocket-client");
  const wsClient = getWebSocketClient();

  // Connect to dashboard
  wsClient.connect();

  // Set up heartbeat to keep connection alive
  setInterval(() => {
    wsClient.ping();
  }, 30000); // Every 30 seconds

  // Handle request status updates from dashboard
  wsClient.on("request_status_update", (data) => {
    if (data && data.requestId && data.status) {
      // Notify renderer about status update
      if (mainWindow) {
        mainWindow.webContents.send("request-status-updated", {
          requestId: data.requestId,
          status: data.status,
        });
      }
    }
  });

  // Store client reference globally
  global.wsClient = wsClient;

  logger.info("WebSocket client initialized for dashboard connection");
}

// Validate username format to prevent command injection
function validateUsername(username) {
  if (!username || typeof username !== "string") {
    throw new Error("Invalid username format");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new Error(
      "Invalid username format. Only alphanumeric characters, dashes, and underscores are allowed."
    );
  }
}

// Execute groups command safely using spawn
async function getGroupsForUser(username) {
  return new Promise((resolve, reject) => {
    const proc = spawn("groups", [username]);
    let output = "";
    let errorOutput = "";

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: output });
      } else {
        reject(
          new Error(errorOutput || `groups command failed with code ${code}`)
        );
      }
    });

    proc.on("error", (error) => {
      reject(new Error(`Failed to execute groups: ${error.message}`));
    });
  });
}

// Get current user info
ipcMain.handle("get-user-info", async () => {
  try {
    const username = os.userInfo().username;
    validateUsername(username);

    const { stdout: groups } = await getGroupsForUser(username);
    const isAdmin = groups.includes("admin");

    return {
      username,
      isAdmin,
      fullName: os.userInfo().username,
    };
  } catch (error) {
    logger.error("Error getting user info", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
});

// Check if user is currently admin
ipcMain.handle("check-admin-status", async () => {
  try {
    const username = os.userInfo().username;
    validateUsername(username);

    const { stdout } = await getGroupsForUser(username);
    return stdout.includes("admin");
  } catch (error) {
    logger.error("Error checking admin status", { error: error.message });
    return false;
  }
});

// Validate request data
function validateRequestData(requestData) {
  const errors = [];

  // Validate fullName
  if (!requestData.fullName || typeof requestData.fullName !== "string") {
    errors.push("Full name is required");
  } else {
    const fullName = requestData.fullName.trim();
    if (fullName.length === 0) {
      errors.push("Full name cannot be empty");
    } else if (fullName.length > 100) {
      errors.push("Full name must be less than 100 characters");
    } else if (!/^[a-zA-Z0-9\s\-'.,]+$/.test(fullName)) {
      errors.push("Full name contains invalid characters");
    }
  }

  // Validate duration
  const validDurations = [2, 5, 10, 20, 60, 120];
  const duration = parseInt(requestData.duration, 10);
  if (isNaN(duration) || !validDurations.includes(duration)) {
    errors.push("Invalid duration selected");
  }

  // Validate reason
  if (!requestData.reason || typeof requestData.reason !== "string") {
    errors.push("Reason is required");
  } else {
    const reason = requestData.reason.trim();
    if (reason.length === 0) {
      errors.push("Reason cannot be empty");
    } else if (reason.length > 1000) {
      errors.push("Reason must be less than 1000 characters");
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

// Submit privilege request
ipcMain.handle("request-privileges", async (event, requestData) => {
  try {
    // Validate input data
    validateRequestData(requestData);

    const request = {
      id: require("uuid").v4(),
      username: os.userInfo().username,
      fullName: requestData.fullName.trim(),
      duration: parseInt(requestData.duration, 10),
      reason: requestData.reason.trim(),
      timestamp: new Date().toISOString(),
      status: "pending",
    };

    // Save request to file
    await saveRequest(request);

    // Auto-generate security tokens for the request
    const TokenManager = require("./server/token-manager");
    const tokenManager = TokenManager.getTokenManager();

    const approvalToken = tokenManager.generateSecureToken(
      request.id,
      "approve"
    );
    const denyToken = tokenManager.generateSecureToken(request.id, "deny");

    // Add tokens to request for WebSocket notification
    request.approvalToken = approvalToken.token;
    request.denyToken = denyToken.token;

    // Notify admin dashboard via WebSocket
    await notifyAdminDashboard(request);

    return {
      success: true,
      requestId: request.id,
      // Include tokens in response (for debugging/logging purposes)
      tokens: {
        approvalToken: approvalToken.token,
        denyToken: denyToken.token,
        expiresAt: approvalToken.expiresAt,
      },
    };
  } catch (error) {
    logger.error("Error submitting request", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
});

// Get pending requests
ipcMain.handle("get-pending-requests", async () => {
  try {
    const requests = await loadRequests();
    return requests.filter(
      (r) => r.status === "pending" || r.status === "approved"
    );
  } catch (error) {
    logger.error("Error loading requests", { error: error.message });
    return [];
  }
});

// Get all requests with optional filtering
ipcMain.handle("get-all-requests", async (event, filters = {}) => {
  try {
    let requests = await loadRequests();

    // Apply filters
    if (filters.status) {
      requests = requests.filter((r) => r.status === filters.status);
    }

    if (filters.startDate) {
      const start = new Date(filters.startDate);
      requests = requests.filter((r) => new Date(r.timestamp) >= start);
    }

    if (filters.endDate) {
      const end = new Date(filters.endDate);
      requests = requests.filter((r) => new Date(r.timestamp) <= end);
    }

    // Sort by timestamp (newest first)
    requests.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return requests;
  } catch (error) {
    logger.error("Error loading all requests", { error: error.message });
    return [];
  }
});

// Save request to file with atomic write and locking
async function saveRequest(request) {
  const userDataDir = app.getPath("userData");
  const requestsFile = path.join(userDataDir, "requests.json");
  let release = null;

  try {
    // Ensure the directory exists before trying to lock/write
    await fs.mkdir(userDataDir, { recursive: true });

    // Lock file before writing
    release = await lockfile.lock(requestsFile, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000,
      },
    });

    let requests = [];
    try {
      const data = await fs.readFile(requestsFile, "utf8");
      requests = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, that's okay
    }

    requests.push(request);

    // Atomic write: write to temp file, then rename
    const tempFile = requestsFile + ".tmp";
    await fs.writeFile(tempFile, JSON.stringify(requests, null, 2), "utf8");
    await fs.rename(tempFile, requestsFile);
  } catch (error) {
    logger.error("Error saving request", {
      error: error.message,
      requestId: request.id,
    });
    throw error;
  } finally {
    // Always release the lock
    if (release) {
      await release();
    }
  }
}

// Load requests from file
async function loadRequests() {
  const userDataDir = app.getPath("userData");
  const requestsFile = path.join(userDataDir, "requests.json");

  try {
    // Ensure the directory exists
    await fs.mkdir(userDataDir, { recursive: true });

    // Try to acquire lock with short timeout (read operation)
    const release = await lockfile.lock(requestsFile, {
      retries: {
        retries: 2,
        minTimeout: 50,
        maxTimeout: 200,
      },
    });

    try {
      const data = await fs.readFile(requestsFile, "utf8");
      return JSON.parse(data);
    } finally {
      await release();
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist yet
      return [];
    }
    // If lock acquisition fails, try reading without lock (may get stale data)
    try {
      const data = await fs.readFile(requestsFile, "utf8");
      return JSON.parse(data);
    } catch (readError) {
      return [];
    }
  }
}

// Update request status with atomic write
async function updateRequestStatus(requestId, status, expiresAt = null) {
  const userDataDir = app.getPath("userData");
  const requestsFile = path.join(userDataDir, "requests.json");
  let release = null;

  try {
    // Ensure the directory exists before trying to lock/write
    await fs.mkdir(userDataDir, { recursive: true });

    // Lock file before writing
    release = await lockfile.lock(requestsFile, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000,
      },
    });

    let requests = [];
    try {
      const data = await fs.readFile(requestsFile, "utf8");
      requests = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet
    }

    const request = requests.find((r) => r.id === requestId);
    if (request) {
      request.status = status;
      if (expiresAt) {
        request.expiresAt = expiresAt;
      }

      // Atomic write
      const tempFile = requestsFile + ".tmp";
      await fs.writeFile(tempFile, JSON.stringify(requests, null, 2), "utf8");
      await fs.rename(tempFile, requestsFile);
    }

    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send("request-status-updated", {
        requestId,
        status,
      });
    }

    // Status updates are handled by the dashboard and sent back via WebSocket
    // No need to notify here as the dashboard will broadcast to all clients

    // Send desktop notification
    if (Notification.isSupported()) {
      let title, body;
      if (status === "approved") {
        title = "Request Approved";
        body =
          "Your admin privilege request has been approved. You can now activate your privileges.";
      } else if (status === "denied") {
        title = "Request Denied";
        body = "Your admin privilege request has been denied.";
      } else if (status === "expired") {
        title = "Privileges Expired";
        body = "Your temporary admin privileges have expired and been removed.";
      }

      if (title && body) {
        new Notification({ title, body }).show();
      }
    }
  } catch (error) {
    logger.error("Error updating request status", {
      error: error.message,
      requestId,
      status,
    });
    throw error;
  } finally {
    if (release) {
      await release();
    }
  }
}

// Grant admin privileges
ipcMain.handle("grant-privileges", async (event, requestId) => {
  try {
    const requests = await loadRequests();
    const request = requests.find((r) => r.id === requestId);

    if (!request || request.status !== "approved") {
      throw new Error("Request not found or not approved");
    }

    const PrivilegeHelper = require("./helper/privilege-helper");
    const helper = new PrivilegeHelper();

    await helper.addUserToAdminGroup(request.username);

    // Schedule removal
    const expiresAt = new Date(Date.now() + request.duration * 60 * 1000);
    request.activatedAt = new Date().toISOString();
    await updateRequestStatus(requestId, "active", expiresAt.toISOString());

    const durationMs = request.duration * 60 * 1000;
    const warningTime = Math.max(0, durationMs - 5 * 60 * 1000); // 5 minutes before expiration

    // Schedule warning notification (5 minutes before expiration)
    if (warningTime > 0) {
      setTimeout(() => {
        if (Notification.isSupported()) {
          new Notification({
            title: "Privileges Expiring Soon",
            body: `Your admin privileges will expire in 5 minutes.`,
          }).show();
        }
      }, warningTime);
    }

    // Schedule removal
    setTimeout(async () => {
      await helper.removeUserFromAdminGroup(request.username);
      await updateRequestStatus(requestId, "expired");
      if (mainWindow) {
        mainWindow.webContents.send("privileges-expired");
      }
    }, durationMs);

    return { success: true, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    logger.error("Error granting privileges", {
      error: error.message,
      requestId,
      stack: error.stack,
    });
    throw error;
  }
});

// Expose functions for approval server and admin dashboard
global.updateRequestStatus = updateRequestStatus;
global.loadRequests = loadRequests;

/**
 * Notify admin dashboard via WebSocket about new request
 * Tokens are auto-generated in the request-privileges handler
 */
async function notifyAdminDashboard(request) {
  try {
    if (global.wsClient && global.wsClient.isConnected()) {
      // Send new request notification to dashboard
      const sent = global.wsClient.notifyNewRequest({
        id: request.id,
        username: request.username,
        fullName: request.fullName,
        duration: request.duration,
        reason: request.reason,
        timestamp: request.timestamp,
        status: request.status,
        approvalToken: request.approvalToken,
        denyToken: request.denyToken,
      });

      if (sent) {
        logger.info("New request notified to dashboard via WebSocket", {
          requestId: request.id,
        });
      } else {
        logger.warn("Failed to send request notification to dashboard", {
          requestId: request.id,
        });
      }
    } else {
      logger.warn(
        "WebSocket client not connected to dashboard, request notification skipped",
        {
          requestId: request.id,
        }
      );
    }
  } catch (error) {
    logger.error("Error notifying admin dashboard", {
      error: error.message,
      requestId: request.id,
    });
    // Don't throw - WebSocket notification failure shouldn't block request creation
  }
}

// Legacy function name for backwards compatibility (deprecated - use notifyAdminDashboard)
async function sendRequestEmail(request) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      "SMTP configuration is missing (SMTP_HOST, SMTP_USER, SMTP_PASS)"
    );
  }

  // Use token manager for secure token generation
  const TokenManager = require("./server/token-manager");
  const tokenManager = TokenManager.getTokenManager();

  const approvalTokenData = tokenManager.generateSecureToken(
    request.id,
    "approve"
  );
  const denyTokenData = tokenManager.generateSecureToken(request.id, "deny");

  const approvalUrl = `${APP_SERVER_URL}/approve?token=${approvalTokenData.token}`;
  const denyUrl = `${APP_SERVER_URL}/approve?token=${denyTokenData.token}`;
  const dashboardUrl = `${APP_SERVER_URL}/admin/dashboard.html`;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const payload = {
    id: request.id,
    username: request.username,
    fullName: request.fullName,
    duration: request.duration,
    reason: request.reason,
    timestamp: request.timestamp,
  };

  const mailOptions = {
    from: SMTP_FROM,
    to: ADMIN_EMAIL,
    subject: `Temporary admin privileges request from ${request.fullName} (${request.username})`,
    text: [
      "A new temporary admin privilege request has been submitted:",
      "",
      JSON.stringify(payload, null, 2),
      "",
      "Quick Actions (tokens expire in 15 minutes):",
      "To approve this request, click:",
      approvalUrl,
      "",
      "To deny this request, click:",
      denyUrl,
      "",
      "Or use the Admin Dashboard:",
      dashboardUrl,
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Temporary Admin Privileges Request</h2>
        <p>A new temporary admin privilege request has been submitted:</p>
        <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">${JSON.stringify(
          payload,
          null,
          2
        )}</pre>
        <h3>Quick Actions</h3>
        <p>Tokens expire in 15 minutes.</p>
        <p>
          <a href="${approvalUrl}" style="background: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-right: 10px;">Approve Request</a>
          <a href="${denyUrl}" style="background: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Deny Request</a>
        </p>
        <p>Or use the <a href="${dashboardUrl}">Admin Dashboard</a> for full management.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}
