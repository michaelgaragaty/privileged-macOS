# macOS Privileges Manager - Comprehensive Code Review

## Project Overview

**macOS Privileges Manager** is an Electron-based application that enables temporary administrator privilege management on macOS systems. Users can request temporary admin access, which is approved via email/webhook, and automatically expires after a specified duration.

### Architecture Components

1. **Main Process** (`main.js`): Electron main process handling IPC, privilege management, and email notifications
2. **Renderer Process** (`renderer.js`): Frontend UI logic for request submission and status display
3. **Preload Script** (`preload.js`): Secure IPC bridge between renderer and main process
4. **Privilege Helper** (`helper/privilege-helper.js`): Handles adding/removing users from admin group
5. **Approval Server** (`server/approval-server.js`): Express server for handling approval/denial requests via web tokens
6. **Webhook Service** (`server/webhook-service.js`): Integration with Make.com webhooks for notifications

---

## Current State Analysis

### ✅ Strengths

1. **Security-First Design**: Uses Electron's `contextIsolation` and `nodeIntegration: false`
2. **Secure IPC Bridge**: Proper use of `contextBridge` in preload script
3. **Token-Based Approval**: One-time use tokens for approval/denial actions
4. **Automatic Expiration**: Built-in timeout mechanism for privilege removal
5. **Modern UI**: Clean, responsive design with good UX
6. **Environment Variables**: Configuration via `.env` file

### ⚠️ Critical Security Issues

#### 1. **COMMAND INJECTION VULNERABILITY**

- **Location**: `helper/privilege-helper.js:15, 31`
- **Issue**: Username is directly interpolated into shell commands without sanitization
- **Risk**: CRITICAL - Arbitrary command execution with root privileges
- **Impact**: Complete system compromise

```javascript
// Current (DANGEROUS):
const command = `dseditgroup -o edit -a ${username} -t user admin`;
```

**Attack Vector**: If username contains shell metacharacters like `; rm -rf / #`, it could execute arbitrary commands.

**Fix Required**: Sanitize username or use parameterized execution.

#### 2. **COMMAND INJECTION IN MAIN PROCESS**

- **Location**: `main.js:80, 98`
- **Issue**: Username from `os.userInfo().username` is used in shell commands without validation
- **Risk**: HIGH - While `os.userInfo()` is generally safe, the pattern is dangerous
- **Impact**: Potential command injection if username is manipulated

```javascript
// Current:
const { stdout: groups } = await execPromise(`groups ${username}`);
```

#### 3. **HARDCODED EMAIL ADDRESS**

- **Location**: `main.js:275`
- **Issue**: Email recipient is hardcoded in source code
- **Risk**: MEDIUM - Requires code change to update recipient
- **Impact**: Maintenance issue, should be configurable

```javascript
// Current:
to: "michaelga@brightdata.com",
```

#### 4. **TOKEN STORAGE IN GLOBAL OBJECT**

- **Location**: `main.js:244, approval-server.js:14`
- **Issue**: Approval tokens stored in `global.approvalTokens` object
- **Risk**: MEDIUM - Tokens persist in memory, no expiration mechanism
- **Impact**: Memory leak potential, tokens never expire until app restart

#### 5. **NO INPUT VALIDATION**

- **Location**: `main.js:107-130, renderer.js:56-88`
- **Issue**: User inputs (fullName, reason, duration) are not validated
- **Risk**: MEDIUM - XSS potential, data integrity issues
- **Impact**: Could lead to injection attacks in email/UI

#### 6. **INSECURE TOKEN GENERATION**

- **Location**: `main.js:241, webhook-service.js:19`
- **Issue**: Uses `crypto.randomBytes()` which is good, but tokens have no expiration
- **Risk**: LOW-MEDIUM - Tokens valid indefinitely until used or app restarts
- **Impact**: Long-lived tokens increase attack window

### 🔧 Code Quality Issues

#### 1. **Inconsistent Error Handling**

- Mix of `console.error()` and `throw` statements
- Some errors are swallowed silently (e.g., `loadRequests()` returns empty array on error)
- No structured logging framework
- Errors not logged to file for debugging

#### 2. **Race Condition in Privilege Removal**

- **Location**: `main.js:216-222`
- **Issue**: Uses `setTimeout` for privilege removal, which is lost if app restarts
- **Risk**: HIGH - Privileges may not be removed if app crashes or is closed
- **Impact**: Users may retain admin privileges beyond intended duration

#### 3. **No Persistence for Active Privileges**

- **Issue**: Active privilege timers are only in memory
- **Risk**: HIGH - App restart loses all active timers
- **Impact**: Privileges never expire if app is restarted

#### 4. **File-Based Storage Without Locking**

- **Location**: `main.js:146-171`
- **Issue**: JSON file read/write operations are not atomic
- **Risk**: MEDIUM - Concurrent writes could corrupt data
- **Impact**: Data loss or corruption

#### 5. **No Request ID Validation**

- **Location**: `main.js:197-229`
- **Issue**: Request IDs are UUIDs but not validated for format
- **Risk**: LOW - Could lead to errors if malformed IDs are passed

#### 6. **Missing Environment Variable Validation**

- **Location**: `main.js:17-23`
- **Issue**: SMTP configuration is checked but app continues with partial config
- **Risk**: MEDIUM - Silent failures, unclear error messages

#### 7. **HTML Injection in Approval Server**

- **Location**: `approval-server.js:41-90`
- **Issue**: User-controlled data (title, message) inserted into HTML without escaping
- **Risk**: MEDIUM - XSS if tokens are manipulated
- **Impact**: Potential XSS in approval pages

#### 8. **No Rate Limiting on Approval Server**

- **Location**: `approval-server.js:11-33`
- **Issue**: No rate limiting on `/approve` endpoint
- **Risk**: MEDIUM - Brute force token guessing possible
- **Impact**: Security vulnerability

#### 9. **Inconsistent Duration Units**

- **Location**: `index.html:29-34`
- **Issue**: Options show "2 minutes", "5 minutes", "10 hour", "20 hours" (inconsistent)
- **Risk**: LOW - UX confusion
- **Impact**: User may misunderstand duration

#### 10. **Missing Dependency: axios**

- **Location**: `webhook-service.js:1`
- **Issue**: `axios` is used but not listed in `package.json` dependencies
- **Risk**: MEDIUM - Application will fail if `axios` is not installed
- **Impact**: Runtime error

---

## Detailed Security Analysis

### Command Injection Deep Dive

The most critical issue is command injection in `privilege-helper.js`. Here's why it's dangerous:

```javascript
// Vulnerable code:
async addUserToAdminGroup(username) {
  const command = `dseditgroup -o edit -a ${username} -t user admin`;
  sudoPrompt.exec(command, ...);
}
```

**Attack Scenario**:

1. Attacker manipulates username to: `testuser; rm -rf / #`
2. Command becomes: `dseditgroup -o edit -a testuser; rm -rf / # -t user admin`
3. Shell executes: `dseditgroup -o edit -a testuser` AND `rm -rf /`
4. System is compromised

**Why This Matters**:

- `sudoPrompt.exec()` runs commands with elevated privileges
- No input validation or sanitization
- Username could be manipulated through system configuration or other attack vectors

### Token Security Analysis

Current token implementation:

- ✅ Uses cryptographically secure random bytes
- ❌ No expiration mechanism
- ❌ Stored in global object (memory only)
- ❌ No rate limiting on token validation
- ❌ Tokens valid until used or app restart

**Improvements Needed**:

- Add expiration timestamps to tokens
- Implement rate limiting
- Store tokens with metadata (creation time, request ID)
- Clean up expired tokens periodically

---

## Recommended Fixes (Prioritized)

### 🔴 Priority 1: Critical Security Fixes (IMMEDIATE)

#### 1.1 Fix Command Injection in Privilege Helper

**Current Code** (`helper/privilege-helper.js:15`):

```javascript
const command = `dseditgroup -o edit -a ${username} -t user admin`;
```

**Recommended Fix**:

```javascript
async addUserToAdminGroup(username) {
  // Validate username format (alphanumeric, dash, underscore only)
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new Error('Invalid username format');
  }

  // Use array form to prevent injection
  const args = ['-o', 'edit', '-a', username, '-t', 'user', 'admin'];
  const command = `dseditgroup ${args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ')}`;

  // Or better: use spawn with array arguments
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn('dseditgroup', ['-o', 'edit', '-a', username, '-t', 'user', 'admin'], {
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });
  });
}
```

#### 1.2 Fix Command Injection in Main Process

**Current Code** (`main.js:80`):

```javascript
const { stdout: groups } = await execPromise(`groups ${username}`);
```

**Recommended Fix**:

```javascript
// Validate username first
const username = os.userInfo().username;
if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
  throw new Error("Invalid username format");
}

// Use spawn instead of exec
const { spawn } = require("child_process");
const { stdout: groups } = await new Promise((resolve, reject) => {
  const proc = spawn("groups", [username]);
  let output = "";
  proc.stdout.on("data", (data) => {
    output += data.toString();
  });
  proc.on("close", (code) => {
    if (code === 0) resolve({ stdout: output });
    else reject(new Error(`groups command failed with code ${code}`));
  });
});
```

#### 1.3 Implement Persistent Privilege Expiration

**Current Issue**: Timers are lost on app restart

**Recommended Fix**:

```javascript
// On app startup, check for active privileges and restore timers
async function restoreActivePrivileges() {
  const requests = await loadRequests();
  const now = Date.now();

  for (const request of requests) {
    if (request.status === "active" && request.expiresAt) {
      const expiresAt = new Date(request.expiresAt).getTime();
      const remaining = expiresAt - now;

      if (remaining > 0) {
        // Restore timer
        setTimeout(async () => {
          const helper = new PrivilegeHelper();
          await helper.removeUserFromAdminGroup(request.username);
          await updateRequestStatus(request.id, "expired");
        }, remaining);
      } else {
        // Already expired, remove immediately
        const helper = new PrivilegeHelper();
        await helper.removeUserFromAdminGroup(request.username);
        await updateRequestStatus(request.id, "expired");
      }
    }
  }
}

// Call on app startup
app.whenReady().then(async () => {
  createWindow();
  startApprovalServer();
  await restoreActivePrivileges(); // Add this
  // ...
});
```

#### 1.4 Add Input Validation

**Recommended Addition** (`main.js`):

```javascript
function validateRequestData(requestData) {
  const errors = [];

  // Validate fullName
  if (!requestData.fullName || typeof requestData.fullName !== "string") {
    errors.push("Full name is required");
  } else if (requestData.fullName.length > 100) {
    errors.push("Full name must be less than 100 characters");
  } else if (!/^[a-zA-Z0-9\s\-'.,]+$/.test(requestData.fullName)) {
    errors.push("Full name contains invalid characters");
  }

  // Validate duration
  const validDurations = [2, 5, 10, 20, 60, 120];
  if (!validDurations.includes(requestData.duration)) {
    errors.push("Invalid duration selected");
  }

  // Validate reason
  if (!requestData.reason || typeof requestData.reason !== "string") {
    errors.push("Reason is required");
  } else if (requestData.reason.length > 1000) {
    errors.push("Reason must be less than 1000 characters");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

// Use in request handler:
ipcMain.handle("request-privileges", async (event, requestData) => {
  try {
    validateRequestData(requestData); // Add this
    // ... rest of code
  } catch (error) {
    // ...
  }
});
```

#### 1.5 Fix HTML Injection in Approval Server

**Current Code** (`approval-server.js:82`):

```javascript
<h1 class="success">${title}</h1>
<p>${message}</p>
```

**Recommended Fix**:

```javascript
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

getSuccessPage(title, message) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `...<h1 class="success">${safeTitle}</h1><p>${safeMessage}</p>...`;
}
```

### 🟠 Priority 2: High Priority Fixes

#### 2.1 Add Token Expiration

```javascript
// In main.js, modify token storage:
global.approvalTokens = global.approvalTokens || {};

// Add expiration (1 hour)
const tokenExpiration = Date.now() + 60 * 60 * 1000;
global.approvalTokens[approvalToken] = {
  requestId: request.id,
  action: "approve",
  expiresAt: tokenExpiration,
};

// In approval-server.js, check expiration:
if (!token || !global.approvalTokens || !global.approvalTokens[token]) {
  return res.send(this.getErrorPage("Invalid or expired token"));
}

const tokenData = global.approvalTokens[token];
if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
  delete global.approvalTokens[token];
  return res.send(this.getErrorPage("Token has expired"));
}
```

#### 2.2 Add Rate Limiting

```javascript
// Install: npm install express-rate-limit
const rateLimit = require("express-rate-limit");

const approvalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: "Too many requests, please try again later.",
});

this.app.get("/approve", approvalLimiter, async (req, res) => {
  // ... existing code
});
```

#### 2.3 Make Email Recipient Configurable

```javascript
// In main.js:
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "michaelga@brightdata.com";

// In mailOptions:
to: ADMIN_EMAIL,
```

#### 2.4 Add Atomic File Operations

```javascript
// Use a library like 'proper-lockfile' or implement atomic writes
const lockfile = require("proper-lockfile");

async function saveRequest(request) {
  const requestsFile = path.join(app.getPath("userData"), "requests.json");

  // Lock file before writing
  const release = await lockfile.lock(requestsFile);
  try {
    let requests = [];
    try {
      const data = await fs.readFile(requestsFile, "utf8");
      requests = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet
    }

    requests.push(request);
    const tempFile = requestsFile + ".tmp";
    await fs.writeFile(tempFile, JSON.stringify(requests, null, 2));
    await fs.rename(tempFile, requestsFile); // Atomic on most systems
  } finally {
    await release();
  }
}
```

#### 2.5 Add Missing Dependency

```bash
npm install axios
```

Or add to `package.json`:

```json
"dependencies": {
  "axios": "^1.6.0",
  // ... other deps
}
```

### 🟡 Priority 3: Code Quality Improvements

#### 3.1 Implement Structured Logging

```javascript
// Install: npm install winston
const winston = require("winston");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Replace console.error with logger.error
// Replace console.log with logger.info
```

#### 3.2 Fix Duration Options UI

```html
<!-- In index.html:29-34 -->
<select id="duration">
  <option value="2">2 minutes</option>
  <option value="5">5 minutes</option>
  <option value="10">10 minutes</option>
  <option value="20">20 minutes</option>
  <option value="60">1 hour</option>
  <option value="120">2 hours</option>
</select>
```

#### 3.3 Add Environment Variable Validation

```javascript
function validateEnvironment() {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  // Validate SMTP_PORT is a number
  if (process.env.SMTP_PORT && isNaN(parseInt(process.env.SMTP_PORT, 10))) {
    throw new Error("SMTP_PORT must be a number");
  }
}

// Call at startup
app.whenReady().then(() => {
  try {
    validateEnvironment();
  } catch (error) {
    console.error("Environment validation failed:", error);
    dialog.showErrorBox("Configuration Error", error.message);
    app.quit();
  }
  // ... rest of startup
});
```

#### 3.4 Improve Error Handling

```javascript
// Create custom error classes
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

class PrivilegeError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrivilegeError";
  }
}

// Use in handlers:
ipcMain.handle("request-privileges", async (event, requestData) => {
  try {
    validateRequestData(requestData);
    // ... rest of code
  } catch (error) {
    logger.error("Request privilege error", {
      error: error.message,
      stack: error.stack,
    });
    if (error instanceof ValidationError) {
      throw error; // Let renderer handle validation errors
    }
    throw new Error("Failed to submit request. Please try again.");
  }
});
```

### 🟢 Priority 4: Feature Enhancements

#### 4.1 Add Request History

- Store all requests (not just pending/approved)
- Add filtering by status
- Add date range filtering
- Export to CSV

#### 4.2 Add Notification System

- Desktop notifications when request is approved/denied
- Notification when privileges are about to expire (5 min warning)
- Sound alerts for important events

#### 4.3 Add Audit Logging

- Log all privilege grants/revocations
- Log all approval/denial actions
- Store logs in separate file with rotation
- Include IP addresses, timestamps, user actions

#### 4.4 Add Configuration UI

- Settings panel for SMTP configuration
- Test email functionality
- Webhook URL configuration
- Duration presets configuration

#### 4.5 Add Request Templates

- Pre-defined reasons for common requests
- Quick-select templates
- Custom templates per user

---

## Testing Recommendations

### Unit Tests Needed

1. **Input Validation Tests**

   - Test username sanitization
   - Test request data validation
   - Test duration validation

2. **Security Tests**

   - Test command injection prevention
   - Test token expiration
   - Test rate limiting

3. **Integration Tests**
   - Test full request flow
   - Test privilege grant/revocation
   - Test email sending

### Manual Testing Checklist

- [ ] Test with malicious usernames (special characters, shell commands)
- [ ] Test token expiration
- [ ] Test app restart with active privileges
- [ ] Test concurrent request submissions
- [ ] Test email delivery with various SMTP configurations
- [ ] Test webhook integration
- [ ] Test privilege expiration timing accuracy

---

## Migration Path

### Phase 1 (Week 1): Critical Security Fixes

1. Fix command injection vulnerabilities
2. Add input validation
3. Implement persistent privilege expiration
4. Fix HTML injection
5. Add missing dependencies

### Phase 2 (Week 2): High Priority Fixes

1. Add token expiration
2. Implement rate limiting
3. Make email configurable
4. Add atomic file operations
5. Fix UI inconsistencies

### Phase 3 (Week 3-4): Code Quality

1. Implement structured logging
2. Improve error handling
3. Add environment validation
4. Write unit tests
5. Add integration tests

### Phase 4 (Month 2+): Features

1. Add audit logging
2. Add notification system
3. Add configuration UI
4. Add request templates
5. Performance optimizations

---

## Conclusion

The macOS Privileges Manager is a well-structured Electron application with good security foundations (context isolation, secure IPC). However, it has **critical security vulnerabilities** that must be addressed immediately:

1. **Command injection** in privilege helper and main process (CRITICAL)
2. **Privilege expiration** not persisted across app restarts (HIGH)
3. **Input validation** missing throughout (HIGH)
4. **Token security** needs expiration mechanism (MEDIUM)

The most urgent fix is the command injection vulnerability, which could allow complete system compromise. After addressing security concerns, focus should shift to code quality improvements and feature enhancements.

The application shows good architectural decisions and modern Electron best practices, making it a solid base once the identified issues are resolved.

---

## Additional Resources

- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection)
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [Node.js Child Process Security](https://nodejs.org/en/docs/guides/security/)
- [Express Rate Limiting](https://expressjs.com/en/resources/middleware/rate-limit.html)
