'use strict';

var EARTH_KM = 6371;

function rad(d) { return d * Math.PI / 180; }

/** Great-circle distance in km between {lat, lng} points. */
function distanceKm(a, b) {
  var dLat = rad(b.lat - a.lat);
  var dLng = rad(b.lng - a.lng);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees [0, 360). */
function bearing(a, b) {
  var y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  var x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Smallest angle between two bearings, 0..180. */
function bearingDiff(b1, b2) {
  var d = Math.abs(b1 - b2) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Projection of p onto segment a->b using a local equirectangular approximation (fine for city scale).
 * Returns { t: 0..1 position along the segment, distanceKm: off-route distance }.
 */
function projectOnSegment(p, a, b) {
  var kx = Math.cos(rad((a.lat + b.lat) / 2)) * 111.32;
  var ky = 110.57;
  var ax = a.lng * kx, ay = a.lat * ky;
  var bx = b.lng * kx, by = b.lat * ky;
  var px = p.lng * kx, py = p.lat * ky;
  var dx = bx - ax, dy = by - ay;
  var len2 = dx * dx + dy * dy;
  var t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  var cx = ax + t * dx, cy = ay + t * dy;
  return { t: t, distanceKm: Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) };
}

function isPoint(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
    p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}

module.exports = { distanceKm: distanceKm, bearing: bearing, bearingDiff: bearingDiff, projectOnSegment: projectOnSegment, isPoint: isPoint };
