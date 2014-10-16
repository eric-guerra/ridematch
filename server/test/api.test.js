'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var createApp = require('../src/app');
var MemoryRepo = require('../src/repo/memory');

var KATY = { lat: 29.7858, lng: -95.8245 };
var DOWNTOWN = { lat: 29.7604, lng: -95.3698 };
var MEMORIAL_CITY = { lat: 29.7807, lng: -95.5440 };
var MIDTOWN = { lat: 29.7420, lng: -95.3780 };
var NOW = Date.parse('2014-04-01T06:00:00Z');

function start() {
  return new Promise(function (resolve) {
    var server = createApp(new MemoryRepo(), { jwtSecret: 'test', now: function () { return NOW; } }).listen(0, function () {
      var base = 'http://localhost:' + server.address().port;
      async function call(method, path, body, token) {
        var headers = { 'content-type': 'application/json' };
        if (token) headers.authorization = 'Bearer ' + token;
        var res = await fetch(base + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
        var text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
      }
      async function register(name) {
        var r = await call('POST', '/api/auth/register', { email: name + '@uh.edu', name: name, password: 'password123' });
        return r.body.token;
      }
      resolve({ call: call, register: register, close: function () { return new Promise(function (r) { server.close(r); }); } });
    });
  });
}

var TRIP = { origin: KATY, destination: DOWNTOWN, departAt: '2014-04-01T08:00:00Z', seats: 2, maxDetourKm: 5, flexMinutes: 15 };
var RIDE = { pickup: MEMORIAL_CITY, dropoff: MIDTOWN, earliest: '2014-04-01T08:30:00Z', latest: '2014-04-01T09:00:00Z' };

test('auth flow', async function (t) {
  var api = await start();
  t.after(api.close);
  var reg = await api.call('POST', '/api/auth/register', { email: 'Ana@UH.edu', name: 'Ana', password: 'password123' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, 'ana@uh.edu');
  assert.equal(reg.body.user.passwordHash, undefined, 'hash must never leak');
  assert.equal((await api.call('POST', '/api/auth/register', { email: 'ana@uh.edu', name: 'Ana', password: 'password123' })).status, 409);
  assert.equal((await api.call('POST', '/api/auth/login', { email: 'ana@uh.edu', password: 'wrong-password' })).status, 401);
  var login = await api.call('POST', '/api/auth/login', { email: 'ana@uh.edu', password: 'password123' });
  assert.equal((await api.call('GET', '/api/me', null, login.body.token)).body.user.name, 'Ana');
  assert.equal((await api.call('GET', '/api/me', null, 'garbage')).status, 401);
});

test('driver posts, rider finds, books, driver accepts, seats are enforced', async function (t) {
  var api = await start();
  t.after(api.close);
  var driver = await api.register('driver');
  var rider = await api.register('rider');
  var rider2 = await api.register('rider2');

  var trip = await api.call('POST', '/api/trips', TRIP, driver);
  assert.equal(trip.status, 201);

  var search = await api.call('POST', '/api/matches/search', RIDE, rider);
  assert.equal(search.body.count, 1);
  assert.equal(search.body.matches[0].trip.id, trip.body.id);
  assert.equal((await api.call('POST', '/api/matches/search', RIDE, driver)).body.count, 0, 'drivers do not match their own trips');

  var booking = await api.call('POST', '/api/trips/' + trip.body.id + '/bookings', Object.assign({ seats: 2 }, RIDE), rider);
  assert.equal(booking.status, 201);
  assert.equal((await api.call('POST', '/api/trips/' + trip.body.id + '/bookings', RIDE, rider)).status, 409, 'no duplicate requests');
  var other = await api.call('POST', '/api/trips/' + trip.body.id + '/bookings', RIDE, rider2);

  assert.equal((await api.call('POST', '/api/bookings/' + booking.body.id + '/accept', null, rider)).status, 403, 'riders cannot accept');
  assert.equal((await api.call('POST', '/api/bookings/' + booking.body.id + '/accept', null, driver)).body.status, 'accepted');
  assert.equal((await api.call('POST', '/api/bookings/' + other.body.id + '/accept', null, driver)).status, 409, 'trip is full');

  var detail = await api.call('GET', '/api/trips/' + trip.body.id, null, driver);
  assert.equal(detail.body.seatsTaken, 2);
  assert.equal(detail.body.bookings.length, 2);
  assert.equal((await api.call('GET', '/api/trips/' + trip.body.id, null, rider)).body.bookings, undefined, 'riders do not see other riders');

  assert.equal((await api.call('POST', '/api/matches/search', RIDE, rider2)).body.count, 0, 'full trips are not suggested');

  // Rider cancels: seats come back and the other request can be accepted.
  assert.equal((await api.call('POST', '/api/bookings/' + booking.body.id + '/cancel', null, rider)).body.status, 'cancelled');
  assert.equal((await api.call('POST', '/api/bookings/' + other.body.id + '/accept', null, driver)).body.status, 'accepted');
});

test('infeasible bookings and validation are rejected', async function (t) {
  var api = await start();
  t.after(api.close);
  var driver = await api.register('driver');
  var rider = await api.register('rider');
  var trip = await api.call('POST', '/api/trips', TRIP, driver);

  var wrongWay = await api.call('POST', '/api/trips/' + trip.body.id + '/bookings', { pickup: DOWNTOWN, dropoff: KATY }, rider);
  assert.equal(wrongWay.status, 422);
  assert.ok(wrongWay.body.reasons.indexOf('wrong direction') >= 0);

  var past = await api.call('POST', '/api/trips', Object.assign({}, TRIP, { departAt: '2014-03-01T08:00:00Z' }), driver);
  assert.deepEqual(Object.keys(past.body.errors), ['departAt']);
  var bad = await api.call('POST', '/api/trips', { origin: { lat: 200, lng: 0 }, seats: 9 }, driver);
  assert.deepEqual(Object.keys(bad.body.errors).sort(), ['departAt', 'destination', 'origin', 'seats']);
  assert.equal((await api.call('POST', '/api/trips/' + trip.body.id + '/bookings', RIDE, driver)).status, 422, 'cannot book own trip');
});

test('cancelling a trip cancels its bookings; completed rides can be rated once', async function (t) {
  var api = await start();
  t.after(api.close);
  var driver = await api.register('driver');
  var rider = await api.register('rider');

  var t1 = (await api.call('POST', '/api/trips', TRIP, driver)).body;
  var b1 = (await api.call('POST', '/api/trips/' + t1.id + '/bookings', RIDE, rider)).body;
  await api.call('POST', '/api/bookings/' + b1.id + '/accept', null, driver);
  assert.equal((await api.call('POST', '/api/trips/' + t1.id + '/cancel', null, rider)).status, 403);
  assert.equal((await api.call('POST', '/api/trips/' + t1.id + '/cancel', null, driver)).body.status, 'cancelled');
  var me = await api.call('GET', '/api/me', null, rider);
  assert.equal(me.body.bookings[0].status, 'cancelled');

  var t2 = (await api.call('POST', '/api/trips', TRIP, driver)).body;
  var b2 = (await api.call('POST', '/api/trips/' + t2.id + '/bookings', RIDE, rider)).body;
  assert.equal((await api.call('POST', '/api/bookings/' + b2.id + '/rate', { stars: 5 }, rider)).status, 409, 'not completed yet');
  await api.call('POST', '/api/bookings/' + b2.id + '/accept', null, driver);
  await api.call('POST', '/api/bookings/' + b2.id + '/complete', null, driver);
  var rated = await api.call('POST', '/api/bookings/' + b2.id + '/rate', { stars: 4 }, rider);
  assert.equal(rated.body.driver.rating, 4);
  assert.equal((await api.call('POST', '/api/bookings/' + b2.id + '/rate', { stars: 5 }, rider)).status, 409, 'only once');
  assert.equal((await api.call('POST', '/api/bookings/' + b2.id + '/cancel', null, rider)).status, 409, 'completed is terminal');
});
