'use strict';

var crypto = require('crypto');
var geo = require('../geo');

function id() { return crypto.randomUUID(); }
function clone(x) { return x && JSON.parse(JSON.stringify(x)); }

/**
 * In-memory repository with the same async API as the PostGIS repository.
 * Booking state machine: requested -> accepted | declined | cancelled; accepted -> cancelled.
 */
function MemoryRepo() {
  this.users = new Map();
  this.trips = new Map();
  this.bookings = new Map();
}

MemoryRepo.prototype.createUser = async function (u) {
  for (var existing of this.users.values()) if (existing.email === u.email) return null;
  var user = Object.assign({ id: id(), rating: null, ratingCount: 0, createdAt: new Date().toISOString() }, u);
  this.users.set(user.id, user);
  return clone(user);
};

MemoryRepo.prototype.userByEmail = async function (email) {
  for (var u of this.users.values()) if (u.email === email) return clone(u);
  return null;
};

MemoryRepo.prototype.user = async function (userId) { return clone(this.users.get(userId)) || null; };

MemoryRepo.prototype.createTrip = async function (t) {
  var trip = Object.assign({ id: id(), seatsTaken: 0, status: 'open', createdAt: new Date().toISOString() }, t);
  this.trips.set(trip.id, trip);
  return this._decorate(trip);
};

MemoryRepo.prototype.trip = async function (tripId) {
  var t = this.trips.get(tripId);
  return t ? this._decorate(t) : null;
};

MemoryRepo.prototype.tripsByDriver = async function (driverId) {
  var self = this;
  return Array.from(this.trips.values()).filter(function (t) { return t.driverId === driverId; })
    .sort(function (a, b) { return a.departAt.localeCompare(b.departAt); }).map(function (t) { return self._decorate(t); });
};

/** Candidate open trips whose route passes within radiusKm of the pickup, departing in [from, to]. */
MemoryRepo.prototype.candidateTrips = async function (pickup, radiusKm, from, to) {
  var self = this;
  return Array.from(this.trips.values()).filter(function (t) {
    var dep = Date.parse(t.departAt);
    return t.status === 'open' && dep >= from && dep <= to && geo.projectOnSegment(pickup, t.origin, t.destination).distanceKm <= radiusKm;
  }).map(function (t) { return self._decorate(t); });
};

MemoryRepo.prototype.setTripStatus = async function (tripId, status) {
  var t = this.trips.get(tripId);
  if (!t) return null;
  t.status = status;
  if (status === 'cancelled') {
    this.bookings.forEach(function (b) {
      if (b.tripId === tripId && (b.status === 'requested' || b.status === 'accepted')) b.status = 'cancelled';
    });
    t.seatsTaken = 0;
  }
  return this._decorate(t);
};

MemoryRepo.prototype.createBooking = async function (b) {
  for (var existing of this.bookings.values()) {
    if (existing.tripId === b.tripId && existing.riderId === b.riderId && (existing.status === 'requested' || existing.status === 'accepted')) {
      return { error: 'duplicate' };
    }
  }
  var booking = Object.assign({ id: id(), status: 'requested', createdAt: new Date().toISOString() }, b);
  this.bookings.set(booking.id, booking);
  return { booking: clone(booking) };
};

MemoryRepo.prototype.booking = async function (bookingId) { return clone(this.bookings.get(bookingId)) || null; };

MemoryRepo.prototype.bookingsForTrip = async function (tripId) {
  return Array.from(this.bookings.values()).filter(function (b) { return b.tripId === tripId; }).map(clone);
};

MemoryRepo.prototype.bookingsForRider = async function (riderId) {
  return Array.from(this.bookings.values()).filter(function (b) { return b.riderId === riderId; }).map(clone);
};

/**
 * Transition a booking. Accepting reserves seats atomically (fails with 'full' if not enough remain);
 * cancelling an accepted booking releases them.
 */
MemoryRepo.prototype.transitionBooking = async function (bookingId, to) {
  var b = this.bookings.get(bookingId);
  if (!b) return { error: 'not_found' };
  var allowed = { requested: ['accepted', 'declined', 'cancelled'], accepted: ['cancelled', 'completed'] };
  if ((allowed[b.status] || []).indexOf(to) < 0) return { error: 'invalid_transition', from: b.status };
  var t = this.trips.get(b.tripId);
  if (to === 'accepted') {
    if (t.status !== 'open') return { error: 'trip_closed' };
    if (t.seats - t.seatsTaken < b.seats) return { error: 'full' };
    t.seatsTaken += b.seats;
  }
  if (to === 'cancelled' && b.status === 'accepted') t.seatsTaken -= b.seats;
  b.status = to;
  return { booking: clone(b) };
};

MemoryRepo.prototype.markRated = async function (bookingId) {
  var b = this.bookings.get(bookingId);
  if (!b || b.rated) return false;
  b.rated = true;
  return true;
};

MemoryRepo.prototype.rateDriver = async function (driverId, stars) {
  var u = this.users.get(driverId);
  if (!u) return null;
  var total = (u.rating || 0) * u.ratingCount + stars;
  u.ratingCount += 1;
  u.rating = Math.round(total / u.ratingCount * 100) / 100;
  return clone(u);
};

MemoryRepo.prototype._decorate = function (t) {
  var driver = this.users.get(t.driverId);
  return Object.assign(clone(t), { driverName: driver ? driver.name : null, driverRating: driver ? driver.rating : null });
};

module.exports = MemoryRepo;
