// pm2 processes on the copixio server. Start/reload: pm2 startOrReload ecosystem.config.cjs && pm2 save
const base = { cwd: "/var/www/copixio", time: true, env: { NODE_ENV: "production" } };
module.exports = {
  apps: [
    { ...base, name: "copixio-web", script: "node_modules/next/dist/bin/next", args: "start -p 3000 -H 127.0.0.1", max_memory_restart: "1200M" },
    // reads the Telegram groups users switched on; queues real signals
    { ...base, name: "copixio-listener", script: "workers/listener.mjs", max_memory_restart: "900M", kill_timeout: 8000 },
    // places orders and manages open trades (stop, targets, manual close)
    { ...base, name: "copixio-trader", script: "workers/trader.mjs", max_memory_restart: "700M", kill_timeout: 15000 },
  ],
};
