'use strict';

var path = require('path');
var createApp = require('./app');
var MemoryRepo = require('./repo/memory');
var PgRepo = require('./repo/postgres');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('JWT_SECRET must be set in production');
  process.exit(1);
}

var repo = process.env.DATABASE_URL ? PgRepo.connect(process.env.DATABASE_URL) : new MemoryRepo();
var app = createApp(repo, {
  jwtSecret: process.env.JWT_SECRET,
  corsOrigin: process.env.CORS_ORIGIN,
  staticDir: path.join(__dirname, '..', '..', 'web')
});
var port = Number(process.env.PORT) || 3000;
app.listen(port, function () {
  console.log('RideMatch API on http://localhost:' + port + (process.env.DATABASE_URL ? ' (postgres)' : ' (memory)'));
});
