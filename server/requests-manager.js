/**
 * Shared Requests Manager
 * Can be used by both main app and admin dashboard
 */
const fs = require("fs").promises;
const path = require("path");
const lockfile = require("proper-lockfile");
const os = require("os");

class RequestsManager {
  constructor() {
    // Get user data directory - works in both Electron and Node.js contexts
    let electronApp;
    try {
      electronApp = require("electron").app;
    } catch (e) {
      // Not in Electron context
      electronApp = null;
    }

    if (electronApp && electronApp.getPath) {
      this.userDataDir = electronApp.getPath("userData");
    } else {
      // Fallback for non-Electron contexts (admin dashboard)
      this.userDataDir = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "temp-admin-privileges"
      );
    }
    this.requestsFile = path.join(this.userDataDir, "requests.json");
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory() {
    await fs.mkdir(this.userDataDir, { recursive: true });
  }

  /**
   * Load requests from file
   */
  async loadRequests() {
    await this.ensureDirectory();

    try {
      // Try to acquire lock with short timeout (read operation)
      const release = await lockfile.lock(this.requestsFile, {
        retries: {
          retries: 2,
          minTimeout: 50,
          maxTimeout: 200,
        },
      });

      try {
        const data = await fs.readFile(this.requestsFile, "utf8");
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
        const data = await fs.readFile(this.requestsFile, "utf8");
        return JSON.parse(data);
      } catch (readError) {
        return [];
      }
    }
  }

  /**
   * Save request to file
   */
  async saveRequest(request) {
    await this.ensureDirectory();
    let release = null;

    try {
      // Lock file before writing
      release = await lockfile.lock(this.requestsFile, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000,
        },
      });

      let requests = [];
      try {
        const data = await fs.readFile(this.requestsFile, "utf8");
        requests = JSON.parse(data);
      } catch (error) {
        // File doesn't exist yet, that's okay
      }

      requests.push(request);

      // Atomic write: write to temp file, then rename
      const tempFile = this.requestsFile + ".tmp";
      await fs.writeFile(tempFile, JSON.stringify(requests, null, 2), "utf8");
      await fs.rename(tempFile, this.requestsFile);
    } catch (error) {
      throw error;
    } finally {
      // Always release the lock
      if (release) {
        await release();
      }
    }
  }

  /**
   * Update request status
   */
  async updateRequestStatus(requestId, status, expiresAt = null) {
    await this.ensureDirectory();
    let release = null;

    try {
      // Lock file before writing
      release = await lockfile.lock(this.requestsFile, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000,
        },
      });

      let requests = [];
      try {
        const data = await fs.readFile(this.requestsFile, "utf8");
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
        const tempFile = this.requestsFile + ".tmp";
        await fs.writeFile(tempFile, JSON.stringify(requests, null, 2), "utf8");
        await fs.rename(tempFile, this.requestsFile);
      }
    } catch (error) {
      throw error;
    } finally {
      // Always release the lock
      if (release) {
        await release();
      }
    }
  }
}

// Singleton instance
let instance = null;

function getRequestsManager() {
  if (!instance) {
    instance = new RequestsManager();
  }
  return instance;
}

module.exports = { RequestsManager, getRequestsManager };

