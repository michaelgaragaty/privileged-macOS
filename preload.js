const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getUserInfo: () => ipcRenderer.invoke('get-user-info'),
  checkAdminStatus: () => ipcRenderer.invoke('check-admin-status'),
  requestPrivileges: (data) => ipcRenderer.invoke('request-privileges', data),
  getPendingRequests: () => ipcRenderer.invoke('get-pending-requests'),
  getAllRequests: (filters) => ipcRenderer.invoke('get-all-requests', filters),
  grantPrivileges: (requestId) => ipcRenderer.invoke('grant-privileges', requestId),
  
  onRequestStatusUpdated: (callback) => {
    ipcRenderer.on('request-status-updated', (event, data) => callback(data));
  },
  
  onPrivilegesExpired: (callback) => {
    ipcRenderer.on('privileges-expired', () => callback());
  }
});
