// pm2 alternative to Docker: `pm2 start ecosystem.config.js && pm2 save && pm2 startup`
module.exports = {
  apps: [{
    name: 'sky-group-reader',
    script: 'server.js',
    cwd: __dirname,
    autorestart: true,
    restart_delay: 10000,
    max_restarts: 1000,
    max_memory_restart: '900M',
    time: true,
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    merge_logs: true,
  }],
};
