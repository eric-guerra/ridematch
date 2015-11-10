# RideMatch

A ride-sharing platform that matches riders with drivers already heading their way: a **Node.js/Express** API on **PostgreSQL + PostGIS**, an **AngularJS** web app with Leaflet maps, and an **Ionic** (Cordova) mobile app.

> Portfolio reference implementation of my 2014 senior capstone project, built using the original stack (Express, AngularJS 1.x, Ionic 1, PostGIS) with current package versions.

```
mobile/ (Ionic 1 + Cordova geolocation)  ─┐
                                           ├──▶  server/ Express REST API (JWT)  ──▶  PostgreSQL + PostGIS
web/ (AngularJS + Leaflet)               ─┘         matching.js · repo/postgres.js
```

## How matching works

1. **Coarse filter (database):** open trips departing near the rider's window whose route passes within 10 km of the pickup. This uses a stored, generated `route` linestring with a partial GiST index (`ST_DWithin`, KNN `<->` ordering).
2. **Precise evaluation (server/src/matching.js)** for each candidate:
   - **Detour** = origin→pickup→drop-off→destination − origin→destination, which must be ≤ the driver's limit
   - **Direction**: the pickup projects before the drop-off on the driver's route, and the headings differ by less than 60°
   - **Time**: estimated pickup (driver departure + distance at 40 km/h) inside the rider's window ± the driver's flexibility
   - **Seats** available
3. **Score** 0–100: detour (40%), time fit (25%), share of the driver's route (20%), driver rating (15%). Infeasible trips carry explicit reasons, which are returned on a booking attempt (`["wrong direction", "heading differs"]`).

## Booking lifecycle

`requested → accepted | declined | cancelled`, `accepted → cancelled | completed`. Accepting reserves seats with a **conditional UPDATE** (`seats - seats_taken >= n`) inside a transaction, backed by a CHECK constraint, so concurrent accepts can't oversell. A partial unique index prevents duplicate active requests. Cancelling a trip cancels its bookings. Riders rate completed rides once, enforced with a compare-and-set.

## Run

```bash
docker compose up                          # API + PostGIS on :3000, web app served at http://localhost:3000
cd server && npm install && npm start      # or: in-memory repository, no database needed
```

Mobile:

```bash
cd mobile && ionic serve                   # set API_BASE in www/js/app.js
ionic cordova run android
```

## Test

```bash
cd server && npm test     # matching unit tests (real Houston geography) + API flow tests
```
