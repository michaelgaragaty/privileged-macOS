# macOS Privileges Manager

A secure Electron-based application for managing temporary administrator privileges on macOS systems. Users can request temporary admin access via a separate admin dashboard connected through secure WebSocket communication. Privileges automatically expire after a specified duration.

## Features

- **Secure Request System**: Users can request temporary admin privileges with justification
- **WebSocket Communication**: Real-time secure communication between app instances and admin dashboard
- **Separate Admin Dashboard**: Independent dashboard server that can handle multiple app instances
- **Auto-Generated Security Tokens**: Security tokens are automatically generated for each request
- **Multiple App Instance Support**: Dashboard handles requests from multiple app instances simultaneously
- **Admin Dashboard**: Web-based interface with password + optional 2FA authentication
- **Automatic Expiration**: Privileges automatically expire after the specified duration
- **Persistent Timers**: Privilege expiration timers are restored on app restart
- **Audit Logging**: Complete audit trail of all actions
- **Rate Limiting**: Protection against brute force attacks
- **Desktop Notifications**: Real-time notifications for approvals and expirations

## Architecture

### Components

#### Main Application (Electron App)
1. **Main Process** (`main.js`): Electron main process handling IPC, privilege management, and WebSocket client connection
2. **Renderer Process** (`renderer.js`): Frontend UI logic for request submission and status display
3. **Preload Script** (`preload.js`): Secure IPC bridge between renderer and main process
4. **WebSocket Client** (`client/websocket-client.js`): Connects to admin dashboard via WebSocket
5. **Privilege Helper** (`helper/privilege-helper.js`): Handles adding/removing users from admin group
6. **Requests Manager** (`server/requests-manager.js`): Shared request storage management

#### Admin Dashboard Server (Separate Process)
1. **Dashboard Server** (`admin-dashboard.js`): Standalone Node.js server for admin dashboard
2. **WebSocket Server** (`server/websocket-server.js`): Handles WebSocket connections from app instances
3. **Admin Dashboard** (`server/admin-dashboard.js`): Web-based admin interface backend
4. **Approval Server** (`server/approval-server.js`): Express server for HTTP routes (token-based approvals)
5. **Token Manager** (`server/token-manager.js`): HMAC-signed token generation and validation
6. **Auth Manager** (`server/auth-manager.js`): Password + 2FA authentication system
7. **Audit Logger** (`server/audit-logger.js`): Security audit logging system
8. **Config Manager** (`server/config-manager.js`): Centralized configuration management

## Prerequisites

- **macOS**: This application is designed for macOS only
- **Node.js**: Version 16 or higher
- **npm**: Comes with Node.js
- **Administrator Access**: Required for initial setup and privilege management

## Installation

1. **Clone or download the repository**

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Create environment file**:

   ```bash
   cp .env.example .env
   ```

4. **Configure environment variables** (see Configuration section below)

5. **Start the admin dashboard server** (in one terminal):
   ```bash
   npm run start:dashboard
   ```

6. **Start the application** (in another terminal):
   ```bash
   npm start
   ```

## Configuration

### Required Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# Server Configuration
APP_SERVER_URL=http://localhost:3000
APP_SERVER_PORT=3000

# SMTP Configuration (Required)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-password
SMTP_SECURE=false
SMTP_FROM=no-reply@example.com

# Admin Configuration
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
ADMIN_2FA_ENABLED=false

# Security Configuration (Required)
# Generate a strong random secret: openssl rand -hex 32
TOKEN_SECRET=your-32-character-minimum-secret-key-here
TOKEN_EXPIRATION_MINUTES=15

# Session Configuration
SESSION_SECRET=your-session-secret-here
SESSION_MAX_AGE=86400000

# Dashboard WebSocket URL (for app to connect to dashboard)
DASHBOARD_WEBSOCKET_URL=ws://localhost:3000/ws

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=10

# Environment
NODE_ENV=development
```

### Generating Secure Secrets

Generate a secure token secret:

```bash
openssl rand -hex 32
```

Generate a session secret:

```bash
openssl rand -hex 32
```

## Deployment

### Local Development

1. Configure your `.env` file
2. **Start the admin dashboard server** (Terminal 1):
   ```bash
   npm run start:dashboard
   ```
   The dashboard will be available at `http://localhost:3000/admin`
   WebSocket endpoint: `ws://localhost:3000/ws`

3. **Start the Electron app** (Terminal 2):
   ```bash
   npm start
   ```
   The application will start and open the Electron window
   The app will automatically connect to the dashboard via WebSocket

4. **Multiple App Instances**: You can run multiple instances of the app - they will all connect to the same dashboard server

### Production Deployment

1. **Build the application**:

   ```bash
   npm run build
   ```

2. **Configure production environment variables**:

   - Set `NODE_ENV=production`
   - Use HTTPS for `APP_SERVER_URL` in production
   - Ensure `TOKEN_SECRET` is strong and unique
   - Configure proper SMTP settings

3. **Security Considerations**:

   - Use HTTPS for the approval server in production
   - Set up a reverse proxy (nginx/Apache) if exposing to the internet
   - Configure firewall rules appropriately
   - Regularly rotate `TOKEN_SECRET` and `SESSION_SECRET`
   - Enable 2FA for admin accounts

4. **Run the built application**:
   - The built application will be in the `dist` directory
   - Launch the `.app` file on macOS

## Admin Dashboard Setup

### Initial Login

1. Access the admin dashboard at `http://localhost:3000/admin`
2. Use the default password from `ADMIN_PASSWORD` environment variable
3. **Important**: Change the default password immediately after first login

### Setting Up 2FA (Recommended)

1. Log into the admin dashboard
2. Navigate to Settings
3. Click "Generate 2FA Secret"
4. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
5. Enter the 6-digit code to verify and enable 2FA

### Using the Dashboard

- **Pending Requests**: View and approve/deny pending privilege requests
- **Request History**: View all requests with filtering options
- **Audit Logs**: View security audit logs with date filtering
- **Settings**: Change password, configure 2FA

## Approval Methods

### Method 1: Admin Dashboard (Primary Method)

1. Log into admin dashboard at `http://localhost:3000/admin`
2. View pending requests from all app instances in real-time
3. Approve or deny with optional reason
4. All actions are logged in audit trail
5. Status updates are broadcast to all connected app instances via WebSocket

### Method 2: Token-Based Approval (Legacy Support)

1. Requests include auto-generated HMAC-signed tokens
2. Tokens expire in 15 minutes (configurable)
3. Use token links for quick approval/denial
4. Token is single-use and validated server-side
5. Access via: `http://localhost:3000/approve?token=<token>`

## WebSocket Communication

### How It Works

1. **App Instance** connects to dashboard WebSocket server at `ws://localhost:3000/ws`
2. **User submits request** → App auto-generates security tokens
3. **App sends request** via WebSocket to dashboard
4. **Dashboard receives** → Saves to shared storage and broadcasts to all admin clients
5. **Admin approves/denies** → Dashboard broadcasts status update to ALL app instances
6. **All app instances receive** → Update their UI in real-time

### Multi-Instance Support

- Multiple app instances can run simultaneously
- Each instance gets a unique connection ID
- All instances receive status updates for all requests
- Dashboard aggregates requests from all instances
- Shared request storage ensures consistency

## Security Features

### Implemented Security Measures

1. **Command Injection Prevention**: All shell commands use parameterized execution
2. **Input Validation**: All user inputs are validated and sanitized
3. **HMAC-Signed Tokens**: Tokens are cryptographically signed and expire after 15 minutes
4. **Rate Limiting**: Protection against brute force attacks (10 requests per 15 minutes)
5. **Session Management**: Secure session handling with HTTP-only cookies
6. **2FA Support**: Optional two-factor authentication for admin accounts
7. **Audit Logging**: Complete audit trail of all security-relevant actions
8. **HTML Injection Prevention**: All user-controlled data is escaped
9. **Atomic File Operations**: File operations use locking to prevent corruption

### Security Best Practices

- Always use HTTPS in production
- Regularly rotate secrets (`TOKEN_SECRET`, `SESSION_SECRET`)
- Enable 2FA for admin accounts
- Monitor audit logs regularly
- Keep dependencies up to date
- Use strong passwords
- Limit network exposure (use firewall rules)

## Troubleshooting

### Application Won't Start

- Check that all required environment variables are set
- Verify `TOKEN_SECRET` is at least 32 characters
- Ensure the admin dashboard server is running first
- Check logs in `logs/` directory

### WebSocket Connection Failed

- Verify the admin dashboard server is running (`npm run start:dashboard`)
- Check that `DASHBOARD_WEBSOCKET_URL` is correct (default: `ws://localhost:3000/ws`)
- Ensure port 3000 is not blocked by firewall
- Check dashboard server logs for connection errors
- The app will automatically retry connection if it fails

### Admin Dashboard Not Accessible

- Verify `APP_SERVER_PORT` is not blocked (default: 3000)
- Check that the dashboard server started successfully
- Review server logs for errors
- Ensure you're accessing `http://localhost:3000/admin` (not the app's server)

### Privileges Not Expiring

- Check that the app is running (timers are in-memory)
- Verify `restoreActivePrivileges()` runs on startup
- Check logs for errors during privilege removal

### 2FA Not Working

- Ensure time on server and authenticator device are synchronized
- Verify the QR code was scanned correctly
- Check that the 6-digit code is entered within the time window

## API Documentation

### Admin API Endpoints

All endpoints require authentication via session cookie.

- `POST /api/admin/login` - Admin login
- `POST /api/admin/logout` - Admin logout
- `GET /api/admin/requests/pending` - Get pending requests
- `GET /api/admin/requests` - Get all requests
- `POST /api/admin/requests/:requestId/approve` - Approve request
- `POST /api/admin/requests/:requestId/deny` - Deny request
- `GET /api/admin/audit-logs` - Get audit logs
- `GET /api/admin/2fa/status` - Get 2FA status
- `POST /api/admin/2fa/generate` - Generate 2FA secret
- `POST /api/admin/2fa/enable` - Enable 2FA
- `POST /api/admin/2fa/disable` - Disable 2FA
- `POST /api/admin/change-password` - Change password

### Public Endpoints

- `GET /approve?token=...` - Approve/deny via token link
- `GET /health` - Health check

## Logging

Logs are stored in the `logs/` directory:

- `combined.log` - All logs
- `error.log` - Error logs only
- `audit.log` - Security audit logs
- `exceptions.log` - Unhandled exceptions
- `rejections.log` - Unhandled promise rejections

## Development

### Project Structure

```
macOS_privileges/
├── client/
│   └── websocket-client.js      # WebSocket client for dashboard connection
├── helper/
│   └── privilege-helper.js      # Privilege management
├── server/
│   ├── websocket-server.js      # WebSocket server for dashboard
│   ├── requests-manager.js      # Shared request storage
│   ├── approval-server.js       # Express server (HTTP routes)
│   ├── admin-dashboard.js       # Admin dashboard backend
│   ├── token-manager.js         # Token management
│   ├── auth-manager.js          # Authentication
│   ├── audit-logger.js          # Audit logging
│   ├── config-manager.js        # Configuration
│   ├── logger.js                # Structured logging
│   ├── errors.js                # Custom errors
│   ├── middleware/
│   │   └── auth.js              # Auth middleware
│   └── public/                   # Admin dashboard frontend
│       ├── login.html
│       ├── dashboard.html
│       ├── admin.css
│       └── admin.js
├── admin-dashboard.js           # Standalone dashboard server entry point
├── main.js                      # Electron main process
├── renderer.js                  # Frontend logic
├── preload.js                   # IPC bridge
├── index.html                   # Main UI
├── styles.css                   # Styles
└── package.json                 # Dependencies
```

### Running in Development

**Terminal 1 - Dashboard Server:**
```bash
NODE_ENV=development npm run start:dashboard
```

**Terminal 2 - Electron App:**
```bash
NODE_ENV=development npm start
```

This will:

- Open DevTools automatically in the Electron app
- Use console logging instead of file logging
- Enable debug-level logging
- Show WebSocket connection status in logs

## Building

Build the application for distribution:

```bash
npm run build
```

The built application will be in the `dist` directory.

## License

[Your License Here]

## Support

For issues, questions, or contributions, please [open an issue](link-to-issues) or contact the maintainers.

## Changelog

### Version 2.0.0

- **WebSocket Architecture**: Real-time communication between app and dashboard
- **Separate Dashboard Server**: Independent admin dashboard process
- **Multi-Instance Support**: Dashboard handles multiple app instances simultaneously
- **Auto-Generated Tokens**: Security tokens automatically generated for each request
- **Real-Time Updates**: Status updates broadcast to all app instances
- **Improved Architecture**: Clean separation between app and dashboard

### Version 1.0.0

- Initial release
- Secure token-based approval system
- Admin dashboard with 2FA
- Audit logging
- Rate limiting
- Desktop notifications
- Persistent privilege expiration
