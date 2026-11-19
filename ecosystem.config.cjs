// pm2 processes on the copixio server. Start: pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "copixio-web",
      cwd: "/var/www/copixio",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1200M",
      time: true,
    },
  ],
};
