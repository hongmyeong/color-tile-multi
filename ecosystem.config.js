module.exports = {
  apps: [{
    name: "color-tile",
    script: "server.js",
    env: { NODE_ENV: "production", PORT: 3000 },
    max_memory_restart: "300M",
    autorestart: true,
  }],
};
