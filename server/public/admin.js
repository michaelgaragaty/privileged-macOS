// Admin Dashboard JavaScript

const API_BASE = '/api/admin';

// Check authentication on page load
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('dashboard.html')) {
        checkAuth();
    } else if (window.location.pathname.includes('login.html')) {
        setupLogin();
    }
});

// Authentication
async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE}/requests/pending`);
        if (!response.ok && response.status === 401) {
            window.location.href = '/admin/login.html';
            return;
        }
        setupDashboard();
    } catch (error) {
        window.location.href = '/admin/login.html';
    }
}

function setupLogin() {
    const form = document.getElementById('loginForm');
    const errorDiv = document.getElementById('errorMessage');
    const passwordInput = document.getElementById('password');
    const twoFactorGroup = document.getElementById('2faGroup');
    const twoFactorInput = document.getElementById('twoFactorToken');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorDiv.style.display = 'none';

        const password = passwordInput.value;
        const twoFactorToken = twoFactorInput.value || null;

        try {
            const response = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, twoFactorToken }),
            });

            const data = await response.json();

            if (data.success) {
                window.location.href = '/admin/dashboard.html';
            } else {
                if (data.error && data.error.includes('2FA')) {
                    twoFactorGroup.style.display = 'block';
                    twoFactorInput.focus();
                } else {
                    errorDiv.textContent = data.error || 'Login failed';
                    errorDiv.style.display = 'block';
                }
            }
        } catch (error) {
            errorDiv.textContent = 'Network error. Please try again.';
            errorDiv.style.display = 'block';
        }
    });
}

function setupDashboard() {
    setupNavigation();
    setupLogout();
    loadPendingRequests();
    setupSettings();
}

// Navigation
function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewName = btn.dataset.view;

            // Update active button
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Show corresponding view
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(`${viewName}View`).classList.add('active');

            // Load view data
            if (viewName === 'requests') {
                loadPendingRequests();
            } else if (viewName === 'history') {
                loadRequestHistory();
            } else if (viewName === 'audit') {
                loadAuditLogs();
            }
        });
    });
}

// Logout
function setupLogout() {
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await fetch(`${API_BASE}/logout`, { method: 'POST' });
            window.location.href = '/admin/login.html';
        } catch (error) {
            console.error('Logout error:', error);
        }
    });
}

// Load pending requests
async function loadPendingRequests() {
    try {
        const response = await fetch(`${API_BASE}/requests/pending`);
        const data = await response.json();

        if (data.success) {
            displayRequests(data.requests, 'requestsList');
        }
    } catch (error) {
        console.error('Error loading requests:', error);
    }
}

// Load request history
async function loadRequestHistory() {
    try {
        const statusFilter = document.getElementById('statusFilter').value;
        const response = await fetch(`${API_BASE}/requests`);
        const data = await response.json();

        if (data.success) {
            let requests = data.requests;
            if (statusFilter) {
                requests = requests.filter(r => r.status === statusFilter);
            }
            displayRequests(requests, 'historyList');
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// Setup status filter
document.getElementById('statusFilter')?.addEventListener('change', loadRequestHistory);

// Display requests
function displayRequests(requests, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (requests.length === 0) {
        container.innerHTML = '<p>No requests found.</p>';
        return;
    }

    container.innerHTML = requests.map(request => `
        <div class="request-item">
            <h3>Request from ${escapeHtml(request.fullName)} (${escapeHtml(request.username)})</h3>
            <p><strong>Duration:</strong> ${request.duration} minutes</p>
            <p><strong>Reason:</strong> ${escapeHtml(request.reason)}</p>
            <p><strong>Requested:</strong> ${new Date(request.timestamp).toLocaleString()}</p>
            <p><strong>Status:</strong> <span class="status-badge status-${request.status}">${request.status}</span></p>
            ${request.expiresAt ? `<p><strong>Expires:</strong> ${new Date(request.expiresAt).toLocaleString()}</p>` : ''}
            ${request.status === 'pending' ? `
                <div class="request-actions">
                    <button class="btn btn-primary" onclick="approveRequest('${request.id}')">Approve</button>
                    <button class="btn btn-danger" onclick="denyRequest('${request.id}')">Deny</button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

// Approve/Deny requests
async function approveRequest(requestId) {
    try {
        const response = await fetch(`${API_BASE}/requests/${requestId}/approve`, {
            method: 'POST',
        });
        const data = await response.json();

        if (data.success) {
            alert('Request approved successfully');
            loadPendingRequests();
        } else {
            alert('Error: ' + (data.error || 'Failed to approve request'));
        }
    } catch (error) {
        alert('Network error. Please try again.');
    }
}

async function denyRequest(requestId) {
    const reason = prompt('Reason for denial (optional):');
    try {
        const response = await fetch(`${API_BASE}/requests/${requestId}/deny`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
        });
        const data = await response.json();

        if (data.success) {
            alert('Request denied successfully');
            loadPendingRequests();
        } else {
            alert('Error: ' + (data.error || 'Failed to deny request'));
        }
    } catch (error) {
        alert('Network error. Please try again.');
    }
}

// Load audit logs
async function loadAuditLogs() {
    try {
        const startDate = document.getElementById('auditStartDate').value;
        const endDate = document.getElementById('auditEndDate').value;

        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        params.append('limit', '100');

        const response = await fetch(`${API_BASE}/audit-logs?${params}`);
        const data = await response.json();

        if (data.success) {
            displayAuditLogs(data.logs);
        }
    } catch (error) {
        console.error('Error loading audit logs:', error);
    }
}

document.getElementById('loadAuditLogs')?.addEventListener('click', loadAuditLogs);

function displayAuditLogs(logs) {
    const container = document.getElementById('auditLogsList');
    if (!container) return;

    if (logs.length === 0) {
        container.innerHTML = '<p>No audit logs found.</p>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="audit-log-item">
            <strong>${escapeHtml(log.action)}</strong> - 
            User: ${escapeHtml(log.user)} - 
            ${new Date(log.timestamp).toLocaleString()} - 
            IP: ${escapeHtml(log.ipAddress)}
            ${log.requestId ? ` - Request: ${escapeHtml(log.requestId)}` : ''}
        </div>
    `).join('');
}

// Settings
async function setupSettings() {
    // Change password form
    document.getElementById('changePasswordForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPassword = document.getElementById('oldPassword').value;
        const newPassword = document.getElementById('newPassword').value;

        try {
            const response = await fetch(`${API_BASE}/change-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword }),
            });
            const data = await response.json();

            if (data.success) {
                alert('Password changed successfully');
                document.getElementById('changePasswordForm').reset();
            } else {
                alert('Error: ' + (data.error || 'Failed to change password'));
            }
        } catch (error) {
            alert('Network error. Please try again.');
        }
    });

    // Load 2FA status
    load2FAStatus();

    // Generate 2FA
    document.getElementById('generate2FABtn')?.addEventListener('click', async () => {
        try {
            const response = await fetch(`${API_BASE}/2fa/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'Admin' }),
            });
            const data = await response.json();

            if (data.success) {
                document.getElementById('qrCode').src = data.qrCode;
                document.getElementById('manualKey').textContent = data.manualEntryKey;
                document.getElementById('2faSetup').style.display = 'block';
                document.getElementById('generate2FABtn').style.display = 'none';
            }
        } catch (error) {
            alert('Error generating 2FA secret');
        }
    });

    // Enable 2FA
    document.getElementById('enable2FABtn')?.addEventListener('click', async () => {
        const token = document.getElementById('verify2FAToken').value;
        try {
            const response = await fetch(`${API_BASE}/2fa/enable`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const data = await response.json();

            if (data.success) {
                alert('2FA enabled successfully');
                load2FAStatus();
            } else {
                alert('Error: ' + (data.error || 'Failed to enable 2FA'));
            }
        } catch (error) {
            alert('Network error. Please try again.');
        }
    });

    // Disable 2FA
    document.getElementById('disable2FABtn')?.addEventListener('click', async () => {
        const password = prompt('Enter your password to disable 2FA:');
        if (!password) return;

        try {
            const response = await fetch(`${API_BASE}/2fa/disable`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const data = await response.json();

            if (data.success) {
                alert('2FA disabled successfully');
                load2FAStatus();
            } else {
                alert('Error: ' + (data.error || 'Failed to disable 2FA'));
            }
        } catch (error) {
            alert('Network error. Please try again.');
        }
    });
}

async function load2FAStatus() {
    try {
        const response = await fetch(`${API_BASE}/2fa/status`);
        const data = await response.json();

        if (data.success) {
            const statusDiv = document.getElementById('2faStatus');
            if (data.enabled) {
                statusDiv.innerHTML = '<p>✅ 2FA is enabled</p>';
                document.getElementById('disable2FABtn').style.display = 'inline-block';
                document.getElementById('generate2FABtn').style.display = 'none';
                document.getElementById('2faSetup').style.display = 'none';
            } else {
                statusDiv.innerHTML = '<p>❌ 2FA is not enabled</p>';
                document.getElementById('generate2FABtn').style.display = 'inline-block';
                document.getElementById('disable2FABtn').style.display = 'none';
                document.getElementById('2faSetup').style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error loading 2FA status:', error);
    }
}

// Utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

