'use strict';

var crypto = require('crypto');
var jwt = require('jsonwebtoken');

var KEYLEN = 64;

function hashPassword(password) {
  var salt = crypto.randomBytes(16);
  var hash = crypto.scryptSync(password, salt, KEYLEN);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  var parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  var expected = Buffer.from(parts[2], 'hex');
  var actual = crypto.scryptSync(password, Buffer.from(parts[1], 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function issueToken(user, secret) {
  return jwt.sign({ sub: user.id, name: user.name }, secret, { expiresIn: '7d', algorithm: 'HS256' });
}

function requireAuth(secret) {
  return function (req, res, next) {
    var header = req.get('Authorization') || '';
    var m = /^Bearer (.+)$/.exec(header);
    if (!m) return res.status(401).json({ error: 'missing bearer token' });
    try {
      var claims = jwt.verify(m[1], secret, { algorithms: ['HS256'] });
      req.user = { id: claims.sub, name: claims.name };
      next();
    } catch (e) {
      res.status(401).json({ error: 'invalid or expired token' });
    }
  };
}

module.exports = { hashPassword: hashPassword, verifyPassword: verifyPassword, issueToken: issueToken, requireAuth: requireAuth };
