const { isIpInSubnet } = require('../utils/subnet');

// Mirrors pseudocode 4.9.5. Browsers do not expose the Wi-Fi SSID to JavaScript, so the
// only automated signal actually obtainable here is the request's source IP; SSID matching
// is included for completeness in case a future native wrapper can supply it, but the
// practical check in this build is the subnet comparison (Section 3.2.5 / 4.9.5).
function verifyNetwork({ ssid, clientIp }, session) {
  if (ssid && session.authorised_ssid && ssid === session.authorised_ssid) {
    return { passed: true };
  }

  if (isIpInSubnet(clientIp, session.authorised_subnet)) {
    return { passed: true };
  }

  return { passed: false, reason: 'NETWORK_UNAUTHORISED' };
}

module.exports = { verifyNetwork };
