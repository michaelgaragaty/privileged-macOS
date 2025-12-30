const { spawn } = require('child_process');
const sudoPrompt = require('sudo-prompt');

class PrivilegeHelper {
  constructor() {
    this.sudoOptions = {
      name: 'Temp Admin Privileges'
    };
  }

  /**
   * Validate username format to prevent command injection
   * @param {string} username - Username to validate
   * @throws {Error} If username format is invalid
   */
  validateUsername(username) {
    if (!username || typeof username !== 'string') {
      throw new Error('Username must be a non-empty string');
    }
    // Only allow alphanumeric, dash, and underscore characters
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      throw new Error('Invalid username format. Only alphanumeric characters, dashes, and underscores are allowed.');
    }
  }

  /**
   * Execute dseditgroup command using spawn for security
   * @param {string[]} args - Command arguments
   * @returns {Promise<string>} Command output
   */
  async executeDseditgroup(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn('dseditgroup', args, {
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `dseditgroup exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to execute dseditgroup: ${error.message}`));
      });
    });
  }

  /**
   * Add user to admin group using sudo
   * @param {string} username - Username to add to admin group
   * @returns {Promise<string>} Command output
   */
  async addUserToAdminGroup(username) {
    // Validate username to prevent command injection
    this.validateUsername(username);

    // Use spawn with array arguments to prevent injection
    const args = ['-o', 'edit', '-a', username, '-t', 'user', 'admin'];
    
    // For sudo operations, we still need sudoPrompt, but with validated input
    // Build command safely with validated username
    const command = `dseditgroup ${args.map(arg => {
      // Escape single quotes in arguments
      return `'${arg.replace(/'/g, "'\\''")}'`;
    }).join(' ')}`;

    return new Promise((resolve, reject) => {
      sudoPrompt.exec(command, this.sudoOptions, (error, stdout, stderr) => {
        if (error) {
          console.error('Error adding user to admin group:', error);
          reject(error);
        } else {
          console.log(`User ${username} added to admin group`);
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Remove user from admin group using sudo
   * @param {string} username - Username to remove from admin group
   * @returns {Promise<string>} Command output
   */
  async removeUserFromAdminGroup(username) {
    // Validate username to prevent command injection
    this.validateUsername(username);

    // Use spawn with array arguments to prevent injection
    const args = ['-o', 'edit', '-d', username, '-t', 'user', 'admin'];
    
    // For sudo operations, we still need sudoPrompt, but with validated input
    // Build command safely with validated username
    const command = `dseditgroup ${args.map(arg => {
      // Escape single quotes in arguments
      return `'${arg.replace(/'/g, "'\\''")}'`;
    }).join(' ')}`;

    return new Promise((resolve, reject) => {
      sudoPrompt.exec(command, this.sudoOptions, (error, stdout, stderr) => {
        if (error) {
          console.error('Error removing user from admin group:', error);
          reject(error);
        } else {
          console.log(`User ${username} removed from admin group`);
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Check if user is in admin group
   * @param {string} username - Username to check
   * @returns {Promise<boolean>} True if user is admin
   */
  async checkIfUserIsAdmin(username) {
    // Validate username to prevent command injection
    this.validateUsername(username);

    try {
      // Use spawn instead of exec to prevent injection
      const { stdout } = await new Promise((resolve, reject) => {
        const proc = spawn('groups', [username]);
        let output = '';
        let errorOutput = '';

        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ stdout: output });
          } else {
            reject(new Error(errorOutput || `groups command failed with code ${code}`));
          }
        });

        proc.on('error', (error) => {
          reject(error);
        });
      });

      return stdout.includes('admin');
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }
}

module.exports = PrivilegeHelper;
