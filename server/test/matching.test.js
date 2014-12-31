'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var geo = require('../src/geo');
var matching = require('../src/matching');

var KATY = { lat: 29.7858, lng: -95.8245 };
var DOWNTOWN = { lat: 29.7604, lng: -95.3698 };
var MEMORIAL_CITY = { lat: 29.7807, lng: -95.5440 };
var MIDTOWN = { lat: 29.7420, lng: -95.3780 };
var GALVESTON = { lat: 29.3013, lng: -94.7977 };

function trip(overrides) {
  return Object.assign({
    id: 't1', driverId: 'd1', status: 'open', origin: KATY, destination: DOWNTOWN,
    departAt: '2014-04-01T08:00:00Z', seats: 3, seatsTaken: 0, maxDetourKm: 5, flexMinutes: 15, driverRating: 4.8
  }, overrides);
}

function request(overrides) {
  return Object.assign({
    riderId: 'r1', pickup: MEMORIAL_CITY, dropoff: MIDTOWN,
    earliest: '2014-04-01T08:30:00Z', latest: '2014-04-01T09:00:00Z', seats: 1
  }, overrides);
}

test('geo helpers', function () {
  assert.ok(Math.abs(geo.distanceKm(KATY, DOWNTOWN) - 44) < 2);
  assert.ok(geo.bearing(KATY, DOWNTOWN) > 80 && geo.bearing(KATY, DOWNTOWN) < 100, 'Katy to downtown heads east');
  assert.equal(geo.bearingDiff(350, 10), 20);
  var p = geo.projectOnSegment(MEMORIAL_CITY, KATY, DOWNTOWN);
  assert.ok(p.t > 0.5 && p.t < 0.75 && p.distanceKm < 2);
  assert.ok(geo.isPoint(KATY) && !geo.isPoint({ lat: 91, lng: 0 }) && !geo.isPoint(null));
});

test('a rider along the route is a good match', function () {
  var m = matching.evaluate(trip(), request());
  assert.equal(m.feasible, true, JSON.stringify(m));
  assert.ok(m.detourKm < 5);
  assert.ok(m.score > 60);
  assert.ok(Date.parse(m.pickupEta) > Date.parse('2014-04-01T08:30:00Z'));
});

test('infeasibility reasons', function () {
  assert.deepEqual(matching.evaluate(trip(), request({ pickup: DOWNTOWN, dropoff: KATY })).reasons, ['detour too long', 'wrong direction', 'heading differs']);
  assert.ok(matching.evaluate(trip(), request({ dropoff: GALVESTON })).reasons.indexOf('detour too long') >= 0);
  assert.deepEqual(matching.evaluate(trip({ seatsTaken: 3 }), request()).reasons, ['not enough seats']);
  assert.deepEqual(matching.evaluate(trip(), request({ earliest: '2014-04-01T12:00:00Z', latest: '2014-04-01T13:00:00Z' })).reasons, ['time window mismatch']);
});

test('flexibility widens the time window', function () {
  var tight = request({ earliest: '2014-04-01T08:55:00Z', latest: '2014-04-01T09:30:00Z' });
  assert.equal(matching.evaluate(trip({ flexMinutes: 0 }), tight).feasible, false);
  assert.equal(matching.evaluate(trip({ flexMinutes: 20 }), tight).feasible, true);
});

test('ranking prefers smaller detours and skips own and closed trips', function () {
  var near = trip({ id: 'near' });
  var detour = trip({ id: 'detour', destination: { lat: 29.775, lng: -95.37 } }); // ~3.5 km detour vs ~1.9
  var own = trip({ id: 'own', driverId: 'r1' });
  var closed = trip({ id: 'closed', status: 'cancelled' });
  var ranked = matching.rankTrips([detour, own, near, closed], request());
  assert.deepEqual(ranked.map(function (r) { return r.trip.id; }), ['near', 'detour']);

  var explained = matching.rankTrips([near, trip({ id: 'full', seatsTaken: 3 })], request(), { explain: true });
  assert.equal(explained.rejected[0].trip.id, 'full');
});
