const axios = require('axios');
const { getTokenManager } = require('./token-manager');
const { getConfig } = require('./config-manager');
const logger = require('./logger');

const tokenManager = getTokenManager();
const config = getConfig();

class WebhookService {
  constructor() {
    // Verify required environment variables
    if (!process.env.MAKE_WEBHOOK_URL) {
      logger.warn('MAKE_WEBHOOK_URL is not configured. Webhook notifications will not work.');
    }

    this.webhookUrl = process.env.MAKE_WEBHOOK_URL;
    this.appServerUrl = config.get('appServerUrl');
  }

  async sendApprovalRequest(request) {
    if (!this.webhookUrl) {
      throw new Error('Make webhook URL is not configured');
    }

    // Use token manager for secure token generation
    const approvalTokenData = tokenManager.generateSecureToken(request.id, 'approve');
    const denyTokenData = tokenManager.generateSecureToken(request.id, 'deny');
    
    const approvalUrl = `${this.appServerUrl}/approve?token=${approvalTokenData.token}`;
    const denyUrl = `${this.appServerUrl}/approve?token=${denyTokenData.token}`;
    const dashboardUrl = `${this.appServerUrl}/admin/dashboard.html`;
    
    // Prepare webhook payload
    const payload = {
      type: 'approval_request',
      request: {
        id: request.id,
        username: request.username,
        fullName: request.fullName,
        duration: request.duration,
        durationHours: (request.duration / 60).toFixed(1),
        reason: request.reason,
        timestamp: request.timestamp,
        timestampFormatted: new Date(request.timestamp).toLocaleString()
      },
      actions: {
        approveUrl: approvalUrl,
        denyUrl: denyUrl,
        approveToken: approvalTokenData.token,
        denyToken: denyTokenData.token,
        dashboardUrl: dashboardUrl
      }
    };

    try {
      logger.info('Sending approval request to Make webhook', { requestId: request.id });
      const response = await axios.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      logger.info('Approval request sent successfully', { status: response.status });
      return response.data;
    } catch (error) {
      logger.error('Error sending webhook', { 
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error(`Failed to send webhook: ${error.message}`);
    }
  }

  async sendApprovalNotification(request) {
    if (!this.webhookUrl) return;

    const payload = {
      type: 'approval_notification',
      request: {
        id: request.id,
        username: request.username,
        fullName: request.fullName,
        duration: request.duration,
        status: 'approved'
      },
      message: `✅ Your admin privilege request has been approved! Duration: ${request.duration} minutes.`
    };

    try {
      await axios.post(this.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });
      logger.info('Approval notification sent');
    } catch (error) {
      logger.error('Error sending approval notification', { error: error.message });
    }
  }

  async sendDenialNotification(request, reason = null) {
    if (!this.webhookUrl) return;

    const payload = {
      type: 'denial_notification',
      request: {
        id: request.id,
        username: request.username,
        fullName: request.fullName,
        duration: request.duration,
        status: 'denied',
        reason: reason
      },
      message: `❌ Your admin privilege request has been denied. ${reason ? `Reason: ${reason}` : ''}`
    };

    try {
      await axios.post(this.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });
      logger.info('Denial notification sent');
    } catch (error) {
      logger.error('Error sending denial notification', { error: error.message });
    }
  }

  async sendExpirationNotification(request) {
    if (!this.webhookUrl) return;

    const payload = {
      type: 'expiration_notification',
      request: {
        id: request.id,
        username: request.username,
        fullName: request.fullName,
        duration: request.duration,
        status: 'expired'
      },
      message: `⏰ Admin privileges for ${request.fullName} have expired and been removed.`
    };

    try {
      await axios.post(this.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });
      logger.info('Expiration notification sent');
    } catch (error) {
      logger.error('Error sending expiration notification', { error: error.message });
    }
  }

  async verifyConnection() {
    if (!this.webhookUrl) {
      logger.error('Make webhook URL is not configured');
      return false;
    }

    try {
      logger.info('Testing Make webhook connection', { url: this.webhookUrl });
      
      const testPayload = {
        type: 'test',
        message: 'Test connection from Temp Admin Privileges app',
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(this.webhookUrl, testPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      logger.info('Webhook connection verified successfully', { status: response.status });
      return true;
    } catch (error) {
      logger.error('Webhook connection failed', { 
        error: error.message,
        url: this.webhookUrl
      });
      return false;
    }
  }
}

module.exports = WebhookService;
