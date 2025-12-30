# macOS Privileges Manager

A secure Electron-based application for managing temporary administrator privileges on macOS systems. Users can request temporary admin access, which is approved via email/webhook or admin dashboard, and automatically expires after a specified duration.

## Features

- **Secure Request System**: Users can request temporary admin privileges with justification
- **Multiple Approval Methods**:
  - Email-based approval with secure HMAC-signed tokens
  - Admin dashboard with password + optional 2FA authentication
  - Webhook integration (Make.com)
- **Automatic Expiration**: Privileges automatically expire after the specified duration
- **Persistent Timers**: Privilege expiration timers are restored on app restart
- **Audit Logging**: Complete audit trail of all actions
- **Rate Limiting**: Protection against brute force attacks
- **Desktop Notifications**: Real-time notifications for approvals and expirations

## Architecture

### Components

1. **Main Process** (`main.js`): Electron main process handling IPC, privilege management, and email notifications
2. **Renderer Process** (`renderer.js`): Frontend UI logic for request submission and status display
3. **Preload Script** (`preload.js`): Secure IPC bridge between renderer and main process
4. **Privilege Helper** (`helper/privilege-helper.js`): Handles adding/removing users from admin group
5. **Approval Server** (`server/approval-server.js`): Express server for handling approval/denial requests
6. **Admin Dashboard** (`server/admin-dashboard.js`): Web-based admin interface
7. **Token Manager** (`server/token-manager.js`): HMAC-signed token generation and validation
8. **Auth Manager** (`server/auth-manager.js`): Password + 2FA authentication system
9. **Audit Logger** (`server/audit-logger.js`): Security audit logging system

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

5. **Start the application**:
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

# Webhook Configuration (Optional)
MAKE_WEBHOOK_URL=https://hook.integromat.com/your-webhook-url

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
2. Run `npm start`
3. The application will start and open the Electron window
4. The approval server will be available at `http://localhost:3000`
5. The admin dashboard will be available at `http://localhost:3000/admin`

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

### Method 1: Email Token Links

1. Admin receives email with approval/denial links
2. Tokens are HMAC-signed and expire in 15 minutes
3. Click the link to approve or deny
4. Token is single-use and validated server-side

### Method 2: Admin Dashboard

1. Log into admin dashboard
2. View pending requests
3. Approve or deny with optional reason
4. All actions are logged in audit trail

### Method 3: Webhook Integration

1. Configure `MAKE_WEBHOOK_URL` in environment
2. Requests are sent to webhook with approval URLs
3. Integrate with your workflow automation tool

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
- Verify SMTP configuration is correct
- Check logs in `logs/` directory
- Ensure `TOKEN_SECRET` is at least 32 characters

### Email Not Sending

- Verify SMTP credentials are correct
- Check SMTP port and security settings
- Test SMTP connection with a mail client
- Check firewall rules

### Admin Dashboard Not Accessible

- Verify `APP_SERVER_PORT` is not blocked
- Check that the approval server started successfully
- Review server logs for errors

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
├── helper/
│   └── privilege-helper.js      # Privilege management
├── server/
│   ├── approval-server.js       # Express server
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
├── main.js                      # Electron main process
├── renderer.js                  # Frontend logic
├── preload.js                   # IPC bridge
├── index.html                   # Main UI
├── styles.css                   # Styles
└── package.json                 # Dependencies
```

### Running in Development

```bash
NODE_ENV=development npm start
```

This will:

- Open DevTools automatically
- Use console logging instead of file logging
- Enable debug-level logging

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

### Version 1.0.0

- Initial release
- Secure token-based approval system
- Admin dashboard with 2FA
- Audit logging
- Rate limiting
- Desktop notifications
- Persistent privilege expiration
