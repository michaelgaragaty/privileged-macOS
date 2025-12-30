#!/usr/bin/env node
/**
 * Separate Admin Dashboard Server
 * Run this as a standalone process: node admin-dashboard.js
 */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const http = require("http");
const path = require("path");
const { getConfig } = require("./server/config-manager");
const logger = require("./server/logger");
const WebSocketServer = require("./server/websocket-server");
const AdminDashboard = require("./server/admin-dashboard");

const config = getConfig();

// Create Express app
const app = express();
const server = http.createServer(app);

// Setup middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files for admin dashboard
app.use("/admin", express.static(path.join(__dirname, "server", "public")));

// Redirect root to admin login
app.get("/", (req, res) => {
  res.redirect("/admin/login.html");
});

// Redirect /admin to login
app.get("/admin", (req, res) => {
  res.redirect("/admin/login.html");
});

// Initialize WebSocket server
const wsServer = new WebSocketServer(server);

// Initialize admin dashboard routes
const approvalServer = {
  getApp: () => app,
  getWebSocketServer: () => wsServer,
};
new AdminDashboard(approvalServer);

// Start server
const port = config.get("appServerPort") || 3000;
server.listen(port, () => {
  logger.info("Admin Dashboard Server started", {
    port,
    url: `http://localhost:${port}`,
    websocket: `ws://localhost:${port}/ws`,
  });
  console.log(`\n✅ Admin Dashboard running at http://localhost:${port}`);
  console.log(`   WebSocket endpoint: ws://localhost:${port}/ws\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  wsServer.close();
  server.close(() => {
    logger.info("Admin Dashboard Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  wsServer.close();
  server.close(() => {
    logger.info("Admin Dashboard Server closed");
    process.exit(0);
  });
});

