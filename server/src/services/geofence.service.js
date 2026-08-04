const { haversineDistanceMeters } = require('../utils/haversine');

// Mirrors pseudocode 4.9.4. The radius is per-session (not a global constant) so a large
// lecture hall and a small tutorial room can each be configured appropriately (Section 4.9.4).
function verifyGeofence(coordinates, session) {
  if (
    !coordinates ||
    typeof coordinates.lat !== 'number' ||
    typeof coordinates.lng !== 'number'
  ) {
    return { passed: false, reason: 'GEOFENCE_MISSING_COORDINATES' };
  }

  const distance = haversineDistanceMeters(
    { lat: Number(session.geofence_lat), lng: Number(session.geofence_lng) },
    coordinates
  );

  if (distance <= session.geofence_radius_m) {
    return { passed: true, distance };
  }

  return { passed: false, reason: 'GEOFENCE_OUT_OF_RANGE', distance };
}

module.exports = { verifyGeofence };
