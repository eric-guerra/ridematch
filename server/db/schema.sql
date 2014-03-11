CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    rating         NUMERIC(3, 2),
    rating_count   INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trips (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id          UUID NOT NULL REFERENCES users (id),
    origin             GEOGRAPHY(POINT, 4326) NOT NULL,
    destination        GEOGRAPHY(POINT, 4326) NOT NULL,
    -- Straight-line route used for the coarse "passes near the pickup" filter.
    route              GEOGRAPHY(LINESTRING, 4326)
                       GENERATED ALWAYS AS (ST_MakeLine(origin::geometry, destination::geometry)::geography) STORED,
    origin_label       TEXT,
    destination_label  TEXT,
    depart_at          TIMESTAMPTZ NOT NULL,
    seats              SMALLINT NOT NULL CHECK (seats BETWEEN 1 AND 7),
    seats_taken        SMALLINT NOT NULL DEFAULT 0,
    max_detour_km      NUMERIC(5, 2) NOT NULL DEFAULT 5,
    flex_minutes       SMALLINT NOT NULL DEFAULT 15,
    price_cents        INT NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'completed')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seats_not_oversold CHECK (seats_taken BETWEEN 0 AND seats)
);
-- Spatial index for ST_DWithin / KNN ordering; partial so finished trips don't bloat it.
CREATE INDEX trips_route_open_gix ON trips USING GIST (route) WHERE status = 'open';
CREATE INDEX trips_depart_open_idx ON trips (depart_at) WHERE status = 'open';
CREATE INDEX trips_driver_idx ON trips (driver_id, depart_at);

CREATE TABLE bookings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id     UUID NOT NULL REFERENCES trips (id),
    rider_id    UUID NOT NULL REFERENCES users (id),
    seats       SMALLINT NOT NULL CHECK (seats BETWEEN 1 AND 7),
    pickup      GEOGRAPHY(POINT, 4326) NOT NULL,
    dropoff     GEOGRAPHY(POINT, 4326) NOT NULL,
    status      TEXT NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested', 'accepted', 'declined', 'cancelled', 'completed')),
    rated       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One active request per rider per trip.
CREATE UNIQUE INDEX bookings_active_unique ON bookings (trip_id, rider_id) WHERE status IN ('requested', 'accepted');
CREATE INDEX bookings_rider_idx ON bookings (rider_id, created_at DESC);
