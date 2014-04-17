'use strict';

var express = require('express');
var auth = require('./auth');
var validate = require('./validation');
var rankTrips = require('./matching').rankTrips;
var evaluate = require('./matching').evaluate;

/** Coarse filter: the trip's route must pass this close to the pickup (matching then checks detour precisely). */
var SEARCH_RADIUS_KM = 10;

function wrap(fn) {
  return function (req, res, next) { Promise.resolve(fn(req, res, next)).catch(next); };
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, rating: u.rating === undefined ? null : u.rating };
}

function createApp(repo, options) {
  options = options || {};
  var secret = options.jwtSecret || 'dev-secret-change-me';
  var now = options.now || Date.now;
  var app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(function (req, res, next) {
    // The Ionic app and Angular web client may be served from other origins during development.
    res.set('Access-Control-Allow-Origin', options.corsOrigin || '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  if (options.staticDir) app.use(express.static(options.staticDir));

  var requireAuth = auth.requireAuth(secret);

  // ---- auth ----
  app.post('/api/auth/register', wrap(async function (req, res) {
    var b = req.body || {};
    var email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(422).json({ errors: { email: 'valid email required' } });
    if (typeof b.password !== 'string' || b.password.length < 8) return res.status(422).json({ errors: { password: 'at least 8 characters' } });
    if (!b.name || String(b.name).trim().length < 2) return res.status(422).json({ errors: { name: 'name required' } });
    var user = await repo.createUser({ email: email, name: String(b.name).trim(), passwordHash: auth.hashPassword(b.password) });
    if (!user) return res.status(409).json({ error: 'email already registered' });
    res.status(201).json({ token: auth.issueToken(user, secret), user: publicUser(user) });
  }));

  app.post('/api/auth/login', wrap(async function (req, res) {
    var b = req.body || {};
    var user = await repo.userByEmail(String(b.email || '').trim().toLowerCase());
    if (!user || !auth.verifyPassword(String(b.password || ''), user.passwordHash)) {
      return res.status(401).json({ error: 'invalid email or password' });
    }
    res.json({ token: auth.issueToken(user, secret), user: publicUser(user) });
  }));

  app.get('/api/me', requireAuth, wrap(async function (req, res) {
    var user = await repo.user(req.user.id);
    if (!user) return res.status(401).json({ error: 'unknown user' });
    res.json({ user: publicUser(user), trips: await repo.tripsByDriver(user.id), bookings: await repo.bookingsForRider(user.id) });
  }));

  // ---- driver: trips ----
  app.post('/api/trips', requireAuth, wrap(async function (req, res) {
    var b = req.body || {};
    var errors = validate.trip(b, now());
    if (Object.keys(errors).length) return res.status(422).json({ errors: errors });
    var trip = await repo.createTrip({
      driverId: req.user.id, origin: b.origin, destination: b.destination, originLabel: b.originLabel,
      destinationLabel: b.destinationLabel, departAt: new Date(b.departAt).toISOString(), seats: b.seats,
      maxDetourKm: b.maxDetourKm !== undefined ? b.maxDetourKm : 5, flexMinutes: b.flexMinutes !== undefined ? b.flexMinutes : 15,
      priceCents: b.priceCents || 0
    });
    res.status(201).json(trip);
  }));

  app.get('/api/trips/:id', requireAuth, wrap(async function (req, res) {
    var trip = await repo.trip(req.params.id);
    if (!trip) return res.status(404).json({ error: 'not_found' });
    var body = Object.assign({}, trip);
    if (trip.driverId === req.user.id) body.bookings = await repo.bookingsForTrip(trip.id);
    res.json(body);
  }));

  app.post('/api/trips/:id/cancel', requireAuth, wrap(async function (req, res) {
    var trip = await repo.trip(req.params.id);
    if (!trip) return res.status(404).json({ error: 'not_found' });
    if (trip.driverId !== req.user.id) return res.status(403).json({ error: 'not your trip' });
    if (trip.status !== 'open') return res.status(409).json({ error: 'trip is ' + trip.status });
    res.json(await repo.setTripStatus(trip.id, 'cancelled'));
  }));

  // ---- rider: search ----
  app.post('/api/matches/search', requireAuth, wrap(async function (req, res) {
    var b = req.body || {};
    var errors = validate.request(b);
    if (Object.keys(errors).length) return res.status(422).json({ errors: errors });
    var request = { riderId: req.user.id, pickup: b.pickup, dropoff: b.dropoff, earliest: b.earliest, latest: b.latest, seats: b.seats || 1 };
    // Coarse filter in the database, precise scoring in JS.
    var from = Date.parse(b.earliest) - 3 * 3600000;
    var to = Date.parse(b.latest) + 3600000;
    var candidates = await repo.candidateTrips(b.pickup, SEARCH_RADIUS_KM, from, to);
    var ranked = rankTrips(candidates, request, { limit: 20 });
    res.json({
      count: ranked.length,
      matches: ranked.map(function (r) { return Object.assign({ trip: r.trip }, r.match); })
    });
  }));

  // ---- bookings ----
  app.post('/api/trips/:id/bookings', requireAuth, wrap(async function (req, res) {
    var b = req.body || {};
    var trip = await repo.trip(req.params.id);
    if (!trip) return res.status(404).json({ error: 'not_found' });
    if (trip.driverId === req.user.id) return res.status(422).json({ error: 'you cannot book your own trip' });
    if (trip.status !== 'open') return res.status(409).json({ error: 'trip is ' + trip.status });
    var errors = validate.request(Object.assign({ earliest: trip.departAt, latest: trip.departAt }, b));
    if (Object.keys(errors).length) return res.status(422).json({ errors: errors });
    var seats = b.seats || 1;
    // Re-check feasibility server-side: clients can't book trips that don't actually fit.
    var check = evaluate(trip, { pickup: b.pickup, dropoff: b.dropoff, seats: seats,
      earliest: b.earliest || new Date(Date.parse(trip.departAt) - 3600000).toISOString(),
      latest: b.latest || new Date(Date.parse(trip.departAt) + 3 * 3600000).toISOString() });
    if (!check.feasible) return res.status(422).json({ error: 'trip does not fit this ride', reasons: check.reasons });
    var out = await repo.createBooking({ tripId: trip.id, riderId: req.user.id, seats: seats, pickup: b.pickup, dropoff: b.dropoff });
    if (out.error === 'duplicate') return res.status(409).json({ error: 'you already requested this trip' });
    res.status(201).json(out.booking);
  }));

  app.post('/api/bookings/:id/rate', requireAuth, wrap(async function (req, res) {
    var stars = req.body && req.body.stars;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(422).json({ errors: { stars: '1-5' } });
    var booking = await repo.booking(req.params.id);
    if (!booking || booking.riderId !== req.user.id) return res.status(404).json({ error: 'not_found' });
    if (booking.status !== 'completed') return res.status(409).json({ error: 'only completed rides can be rated' });
    // markRated is a compare-and-set, so double-submits can't rate twice.
    if (!(await repo.markRated(booking.id))) return res.status(409).json({ error: 'already rated' });
    var trip = await repo.trip(booking.tripId);
    var driver = await repo.rateDriver(trip.driverId, stars);
    res.json({ driver: { id: driver.id, rating: driver.rating } });
  }));

  var TRANSITIONS = { accept: 'accepted', decline: 'declined', cancel: 'cancelled', complete: 'completed' };
  app.post('/api/bookings/:id/:action', requireAuth, wrap(async function (req, res) {
    var to = TRANSITIONS[req.params.action];
    if (!to) return res.status(404).json({ error: 'unknown action' });
    var booking = await repo.booking(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    var trip = await repo.trip(booking.tripId);
    var isDriver = trip.driverId === req.user.id;
    var isRider = booking.riderId === req.user.id;
    var permitted = { accepted: isDriver, declined: isDriver, completed: isDriver, cancelled: isDriver || isRider };
    if (!permitted[to]) return res.status(403).json({ error: 'not allowed' });

    var out = await repo.transitionBooking(booking.id, to);
    if (out.error === 'full') return res.status(409).json({ error: 'not enough seats left' });
    if (out.error === 'trip_closed') return res.status(409).json({ error: 'trip is no longer open' });
    if (out.error === 'invalid_transition') return res.status(409).json({ error: 'booking is ' + out.from });
    res.json(out.booking);
  }));

  app.use(function (err, req, res, next) {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}

module.exports = createApp;
