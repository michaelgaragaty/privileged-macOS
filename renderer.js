let currentUser = null;

async function init() {
  try {
    currentUser = await window.electronAPI.getUserInfo();
    updateUserInfo();
    await updateAdminStatus();
    await loadRequests();
    
    // Set up event listeners
    document.getElementById('submit-request').addEventListener('click', submitRequest);
    
    // Listen for status updates
    window.electronAPI.onRequestStatusUpdated((data) => {
      console.log('Request status updated:', data);
      loadRequests();
    });
    
    window.electronAPI.onPrivilegesExpired(() => {
      alert('Your admin privileges have expired.');
      updateAdminStatus();
    });
    
    // Refresh admin status every 30 seconds
    setInterval(updateAdminStatus, 30000);
    
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

function updateUserInfo() {
  const userInfoEl = document.getElementById('user-info');
  userInfoEl.textContent = `Logged in as: ${currentUser.username}`;
  
  document.getElementById('fullName').value = currentUser.fullName;
}

async function updateAdminStatus() {
  try {
    const isAdmin = await window.electronAPI.checkAdminStatus();
    const statusEl = document.getElementById('admin-status');
    
    if (isAdmin) {
      statusEl.className = 'status-card admin';
      statusEl.innerHTML = '✅ You currently have administrator privileges';
    } else {
      statusEl.className = 'status-card standard';
      statusEl.innerHTML = '👤 You are currently a standard user';
    }
  } catch (error) {
    console.error('Error updating admin status:', error);
  }
}

async function submitRequest() {
  const fullName = document.getElementById('fullName').value.trim();
  const duration = parseInt(document.getElementById('duration').value);
  const reason = document.getElementById('reason').value.trim();
  
  if (!fullName || !reason) {
    alert('Please fill in all fields');
    return;
  }
  
  const submitBtn = document.getElementById('submit-request');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  
  try {
    const result = await window.electronAPI.requestPrivileges({
      fullName,
      duration,
      reason
    });
    
    alert('Request submitted successfully! An email has been sent to the administrator.');
    document.getElementById('reason').value = '';
    await loadRequests();
    
  } catch (error) {
    console.error('Error submitting request:', error);
    alert('Failed to submit request: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Request';
  }
}

async function loadRequests() {
  try {
    const requests = await window.electronAPI.getPendingRequests();
    const requestsList = document.getElementById('requests-list');
    
    if (requests.length === 0) {
      requestsList.innerHTML = '<div class="empty-state">No requests found</div>';
      return;
    }
    
    requestsList.innerHTML = requests.map(request => `
      <div class="request-item">
        <h3>Request for ${request.duration} minutes</h3>
        <p><strong>Reason:</strong> ${request.reason}</p>
        <p><strong>Requested:</strong> ${new Date(request.timestamp).toLocaleString()}</p>
        <p><strong>Status:</strong> <span class="request-status ${request.status}">${request.status}</span></p>
        ${request.expiresAt ? `<p><strong>Expires:</strong> ${new Date(request.expiresAt).toLocaleString()}</p>` : ''}
        ${request.status === 'approved' ? `
          <button class="btn btn-activate" onclick="activatePrivileges('${request.id}')">Activate Now</button>
        ` : ''}
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Error loading requests:', error);
  }
}

async function activatePrivileges(requestId) {
  try {
    const result = await window.electronAPI.grantPrivileges(requestId);
    alert(`Admin privileges activated! They will expire at ${new Date(result.expiresAt).toLocaleString()}`);
    await updateAdminStatus();
    await loadRequests();
  } catch (error) {
    console.error('Error activating privileges:', error);
    alert('Failed to activate privileges: ' + error.message);
  }
}

// Make function available globally
window.activatePrivileges = activatePrivileges;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
