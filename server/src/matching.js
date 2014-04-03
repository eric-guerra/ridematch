'use strict';

var geo = require('./geo');

/** City driving average used to estimate when a driver reaches the pickup. */
var AVG_SPEED_KMH = 40;
var MS_PER_MIN = 60000;

/**
 * Evaluates whether a rider request fits a driver's trip and how well.
 *
 * Feasibility:
 *   - enough free seats
 *   - detour (origin→pickup→dropoff→destination minus origin→destination) within the driver's limit
 *   - pickup comes before dropoff along the driver's direction (no backtracking)
 *   - the rider's travel direction roughly agrees with the driver's (< 60°)
 *   - the estimated pickup time falls inside the rider's window, allowing the driver's flexibility
 *
 * Score (0..100, higher is better) weighs detour, time fit, how much of the trip is shared, and driver rating.
 */
function evaluate(trip, request) {
  var reasons = [];
  var seatsFree = trip.seats - (trip.seatsTaken || 0);
  if (seatsFree < request.seats) reasons.push('not enough seats');

  var direct = geo.distanceKm(trip.origin, trip.destination);
  var viaRider = geo.distanceKm(trip.origin, request.pickup) +
    geo.distanceKm(request.pickup, request.dropoff) +
    geo.distanceKm(request.dropoff, trip.destination);
  var detourKm = Math.max(0, viaRider - direct);
  if (detourKm > trip.maxDetourKm) reasons.push('detour too long');

  var p = geo.projectOnSegment(request.pickup, trip.origin, trip.destination);
  var d = geo.projectOnSegment(request.dropoff, trip.origin, trip.destination);
  if (p.t > d.t) reasons.push('wrong direction');

  var angle = geo.bearingDiff(geo.bearing(trip.origin, trip.destination), geo.bearing(request.pickup, request.dropoff));
  if (angle > 60) reasons.push('heading differs');

  var departAt = Date.parse(trip.departAt);
  var toPickupMin = geo.distanceKm(trip.origin, request.pickup) / AVG_SPEED_KMH * 60;
  var etaPickup = departAt + toPickupMin * MS_PER_MIN;
  var flexMs = (trip.flexMinutes || 0) * MS_PER_MIN;
  var earliest = Date.parse(request.earliest);
  var latest = Date.parse(request.latest);
  if (etaPickup + flexMs < earliest || etaPickup - flexMs > latest) reasons.push('time window mismatch');

  if (reasons.length) return { feasible: false, reasons: reasons };

  var riderKm = geo.distanceKm(request.pickup, request.dropoff);
  var shared = direct > 0 ? Math.min(1, riderKm / direct) : 0;
  var windowMid = (earliest + latest) / 2;
  var halfWindow = Math.max(MS_PER_MIN, (latest - earliest) / 2 + flexMs);
  var timeFit = 1 - Math.min(1, Math.abs(etaPickup - windowMid) / halfWindow);
  var detourFit = trip.maxDetourKm > 0 ? 1 - detourKm / trip.maxDetourKm : 1;
  var rating = typeof trip.driverRating === 'number' ? trip.driverRating / 5 : 0.8;

  var score = 100 * (0.4 * detourFit + 0.25 * timeFit + 0.2 * shared + 0.15 * rating);
  return {
    feasible: true,
    score: Math.round(score * 10) / 10,
    detourKm: Math.round(detourKm * 100) / 100,
    pickupEta: new Date(etaPickup).toISOString(),
    sharedFraction: Math.round(shared * 100) / 100
  };
}

/** Ranks candidate trips for a request; infeasible ones are dropped (or returned with reasons if explain=true). */
function rankTrips(trips, request, options) {
  options = options || {};
  var results = trips
    .filter(function (t) { return t.driverId !== request.riderId && t.status === 'open'; })
    .map(function (t) { return { trip: t, match: evaluate(t, request) }; });
  var feasible = results.filter(function (r) { return r.match.feasible; })
    .sort(function (a, b) { return b.match.score - a.match.score || a.match.detourKm - b.match.detourKm; });
  if (options.explain) {
    return { matches: feasible, rejected: results.filter(function (r) { return !r.match.feasible; }) };
  }
  return feasible.slice(0, options.limit || 10);
}

module.exports = { evaluate: evaluate, rankTrips: rankTrips, AVG_SPEED_KMH: AVG_SPEED_KMH };
