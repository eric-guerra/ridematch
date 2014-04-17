'use strict';

var pg = require('pg');

/**
 * PostgreSQL + PostGIS repository. Trip endpoints are stored as geography(Point) so
 * candidate search is an indexed ST_DWithin in meters. Seat reservation uses a
 * conditional UPDATE so concurrent accepts can never oversell a trip.
 */
function PgRepo(pool) {
  this.pool = pool;
}

PgRepo.connect = function (url) {
  return new PgRepo(new pg.Pool({ connectionString: url, max: 10 }));
};

function point(p) {
  return 'SRID=4326;POINT(' + Number(p.lng) + ' ' + Number(p.lat) + ')';
}

var TRIP_COLUMNS = "t.id, t.driver_id AS \"driverId\", ST_Y(t.origin::geometry) AS olat, ST_X(t.origin::geometry) AS olng, " +
  "ST_Y(t.destination::geometry) AS dlat, ST_X(t.destination::geometry) AS dlng, t.origin_label AS \"originLabel\", " +
  "t.destination_label AS \"destinationLabel\", t.depart_at AS \"departAt\", t.seats, t.seats_taken AS \"seatsTaken\", " +
  "t.max_detour_km AS \"maxDetourKm\", t.flex_minutes AS \"flexMinutes\", t.price_cents AS \"priceCents\", t.status, " +
  "t.created_at AS \"createdAt\", u.name AS \"driverName\", u.rating AS \"driverRating\"";

function toTrip(row) {
  if (!row) return null;
  var t = Object.assign({}, row, {
    origin: { lat: row.olat, lng: row.olng },
    destination: { lat: row.dlat, lng: row.dlng },
    departAt: new Date(row.departAt).toISOString(),
    maxDetourKm: Number(row.maxDetourKm),
    driverRating: row.driverRating === null ? null : Number(row.driverRating)
  });
  delete t.olat; delete t.olng; delete t.dlat; delete t.dlng;
  return t;
}

PgRepo.prototype.createUser = async function (u) {
  var r = await this.pool.query(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING ' +
    'RETURNING id, email, name, password_hash AS "passwordHash", rating, rating_count AS "ratingCount"',
    [u.email, u.name, u.passwordHash]);
  return r.rows[0] || null;
};

PgRepo.prototype.userByEmail = async function (email) {
  var r = await this.pool.query('SELECT id, email, name, password_hash AS "passwordHash", rating FROM users WHERE email = $1', [email]);
  return r.rows[0] || null;
};

PgRepo.prototype.user = async function (userId) {
  var r = await this.pool.query('SELECT id, email, name, rating, rating_count AS "ratingCount" FROM users WHERE id = $1', [userId]);
  return r.rows[0] || null;
};

PgRepo.prototype.createTrip = async function (t) {
  var r = await this.pool.query(
    'INSERT INTO trips (driver_id, origin, destination, origin_label, destination_label, depart_at, seats, max_detour_km, flex_minutes, price_cents) ' +
    'VALUES ($1, $2::geography, $3::geography, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
    [t.driverId, point(t.origin), point(t.destination), t.originLabel || null, t.destinationLabel || null, t.departAt,
      t.seats, t.maxDetourKm, t.flexMinutes, t.priceCents || 0]);
  return this.trip(r.rows[0].id);
};

PgRepo.prototype.trip = async function (tripId) {
  var r = await this.pool.query('SELECT ' + TRIP_COLUMNS + ' FROM trips t JOIN users u ON u.id = t.driver_id WHERE t.id = $1', [tripId]);
  return toTrip(r.rows[0]);
};

PgRepo.prototype.tripsByDriver = async function (driverId) {
  var r = await this.pool.query('SELECT ' + TRIP_COLUMNS + ' FROM trips t JOIN users u ON u.id = t.driver_id WHERE t.driver_id = $1 ORDER BY t.depart_at', [driverId]);
  return r.rows.map(toTrip);
};

PgRepo.prototype.candidateTrips = async function (pickup, radiusKm, from, to) {
  var r = await this.pool.query(
    'SELECT ' + TRIP_COLUMNS + ' FROM trips t JOIN users u ON u.id = t.driver_id ' +
    "WHERE t.status = 'open' AND t.depart_at BETWEEN $3 AND $4 AND ST_DWithin(t.route, $1::geography, $2) " +
    'ORDER BY t.route <-> $1::geography LIMIT 200',
    [point(pickup), radiusKm * 1000, new Date(from), new Date(to)]);
  return r.rows.map(toTrip);
};

PgRepo.prototype.setTripStatus = async function (tripId, status) {
  var client = await this.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE trips SET status = $2, seats_taken = CASE WHEN $2 = \'cancelled\' THEN 0 ELSE seats_taken END WHERE id = $1', [tripId, status]);
    if (status === 'cancelled') {
      await client.query("UPDATE bookings SET status = 'cancelled' WHERE trip_id = $1 AND status IN ('requested', 'accepted')", [tripId]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return this.trip(tripId);
};

var BOOKING_COLUMNS = 'id, trip_id AS "tripId", rider_id AS "riderId", seats, status, rated, ' +
  'ST_Y(pickup::geometry) AS plat, ST_X(pickup::geometry) AS plng, ST_Y(dropoff::geometry) AS dlat, ST_X(dropoff::geometry) AS dlng, created_at AS "createdAt"';

function toBooking(row) {
  if (!row) return null;
  var b = Object.assign({}, row, { pickup: { lat: row.plat, lng: row.plng }, dropoff: { lat: row.dlat, lng: row.dlng } });
  delete b.plat; delete b.plng; delete b.dlat; delete b.dlng;
  return b;
}

PgRepo.prototype.createBooking = async function (b) {
  try {
    var r = await this.pool.query(
      'INSERT INTO bookings (trip_id, rider_id, seats, pickup, dropoff) VALUES ($1, $2, $3, $4::geography, $5::geography) RETURNING ' + BOOKING_COLUMNS,
      [b.tripId, b.riderId, b.seats, point(b.pickup), point(b.dropoff)]);
    return { booking: toBooking(r.rows[0]) };
  } catch (e) {
    if (e.code === '23505') return { error: 'duplicate' }; // partial unique index on active bookings
    throw e;
  }
};

PgRepo.prototype.booking = async function (bookingId) {
  var r = await this.pool.query('SELECT ' + BOOKING_COLUMNS + ' FROM bookings WHERE id = $1', [bookingId]);
  return toBooking(r.rows[0]);
};

PgRepo.prototype.bookingsForTrip = async function (tripId) {
  var r = await this.pool.query('SELECT ' + BOOKING_COLUMNS + ' FROM bookings WHERE trip_id = $1 ORDER BY created_at', [tripId]);
  return r.rows.map(toBooking);
};

PgRepo.prototype.bookingsForRider = async function (riderId) {
  var r = await this.pool.query('SELECT ' + BOOKING_COLUMNS + ' FROM bookings WHERE rider_id = $1 ORDER BY created_at DESC', [riderId]);
  return r.rows.map(toBooking);
};

PgRepo.prototype.transitionBooking = async function (bookingId, to) {
  var client = await this.pool.connect();
  try {
    await client.query('BEGIN');
    var cur = (await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId])).rows[0];
    if (!cur) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    var allowed = { requested: ['accepted', 'declined', 'cancelled'], accepted: ['cancelled', 'completed'] };
    if ((allowed[cur.status] || []).indexOf(to) < 0) { await client.query('ROLLBACK'); return { error: 'invalid_transition', from: cur.status }; }

    if (to === 'accepted') {
      // Conditional update: succeeds only if the trip is open and still has room.
      var res = await client.query(
        "UPDATE trips SET seats_taken = seats_taken + $2 WHERE id = $1 AND status = 'open' AND seats - seats_taken >= $2",
        [cur.trip_id, cur.seats]);
      if (res.rowCount === 0) {
        await client.query('ROLLBACK');
        var trip = (await this.pool.query('SELECT status FROM trips WHERE id = $1', [cur.trip_id])).rows[0];
        return { error: trip && trip.status !== 'open' ? 'trip_closed' : 'full' };
      }
    }
    if (to === 'cancelled' && cur.status === 'accepted') {
      await client.query('UPDATE trips SET seats_taken = seats_taken - $2 WHERE id = $1', [cur.trip_id, cur.seats]);
    }
    await client.query('UPDATE bookings SET status = $2 WHERE id = $1', [bookingId, to]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { booking: await this.booking(bookingId) };
};

PgRepo.prototype.markRated = async function (bookingId) {
  var r = await this.pool.query('UPDATE bookings SET rated = TRUE WHERE id = $1 AND rated = FALSE', [bookingId]);
  return r.rowCount === 1;
};

PgRepo.prototype.rateDriver = async function (driverId, stars) {
  var r = await this.pool.query(
    'UPDATE users SET rating = ROUND(((COALESCE(rating, 0) * rating_count + $2) / (rating_count + 1))::numeric, 2), ' +
    'rating_count = rating_count + 1 WHERE id = $1 RETURNING id, name, rating, rating_count AS "ratingCount"', [driverId, stars]);
  return r.rows[0] || null;
};

module.exports = PgRepo;
