module.exports = {
  apps: [
    {
      name: 'flamboyai',
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '600M',

      // Log files — make sure the logs/ directory exists or PM2 creates it
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Automatically restart if it crashes
      autorestart: true,
      restart_delay: 3000,

      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
