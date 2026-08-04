// Great-circle distance in metres between two lat/lng points (Section 3.2.4 / 4.9.4).
// Haversine is used instead of a flat Pythagorean approximation because a degree of
// longitude shrinks away from the equator; ignoring that would make a fixed-radius
// geofence inaccurate at different latitudes.
const EARTH_RADIUS_M = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineDistanceMeters(pointA, pointB) {
  const phi1 = toRadians(pointA.lat);
  const phi2 = toRadians(pointB.lat);
  const deltaPhi = toRadians(pointB.lat - pointA.lat);
  const deltaLambda = toRadians(pointB.lng - pointA.lng);

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

module.exports = { haversineDistanceMeters };
