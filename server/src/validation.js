'use strict';

var isPoint = require('./geo').isPoint;

function isIsoDate(s) {
  return typeof s === 'string' && !isNaN(Date.parse(s));
}

function intIn(n, min, max) {
  return Number.isInteger(n) && n >= min && n <= max;
}

function trip(body, now) {
  var e = {};
  if (!isPoint(body.origin)) e.origin = 'origin {lat,lng} required';
  if (!isPoint(body.destination)) e.destination = 'destination {lat,lng} required';
  if (!isIsoDate(body.departAt)) e.departAt = 'departAt must be an ISO date';
  else if (Date.parse(body.departAt) < now) e.departAt = 'departAt must be in the future';
  if (!intIn(body.seats, 1, 7)) e.seats = 'seats must be 1-7';
  if (body.maxDetourKm !== undefined && !(typeof body.maxDetourKm === 'number' && body.maxDetourKm >= 0 && body.maxDetourKm <= 50)) e.maxDetourKm = 'maxDetourKm must be 0-50';
  if (body.flexMinutes !== undefined && !intIn(body.flexMinutes, 0, 120)) e.flexMinutes = 'flexMinutes must be 0-120';
  if (body.priceCents !== undefined && !intIn(body.priceCents, 0, 100000)) e.priceCents = 'priceCents must be 0-100000';
  return e;
}

function request(body) {
  var e = {};
  if (!isPoint(body.pickup)) e.pickup = 'pickup {lat,lng} required';
  if (!isPoint(body.dropoff)) e.dropoff = 'dropoff {lat,lng} required';
  if (!isIsoDate(body.earliest)) e.earliest = 'earliest must be an ISO date';
  if (!isIsoDate(body.latest)) e.latest = 'latest must be an ISO date';
  if (!e.earliest && !e.latest && Date.parse(body.latest) < Date.parse(body.earliest)) e.latest = 'latest must be after earliest';
  if (body.seats !== undefined && !intIn(body.seats, 1, 7)) e.seats = 'seats must be 1-7';
  return e;
}

module.exports = { trip: trip, request: request };
