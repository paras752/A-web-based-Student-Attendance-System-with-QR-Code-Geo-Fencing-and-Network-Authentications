const { isIpInSubnet } = require('../utils/subnet');

// Network authentication (Section 3.2.5 / 4.9.5).
//
// The ONLY signal used here is the request's source IP, because it is the only one the
// client cannot choose. It is the peer address of the TCP connection; a student cannot set
// it from JavaScript, and app.js deliberately does not blanket-trust X-Forwarded-For, so it
// cannot be forged with a header either.
//
// A session's `authorised_ssid` is NOT consulted. It used to be: if the submitted ssid
// matched the session's, this function returned pass before the IP was ever checked. Since
// browsers cannot read a device's Wi-Fi SSID, that value could only ever have come from the
// request body - so anyone who knew (or guessed) the campus network name could send
// {"ssid":"Campus_WiFi"} from anywhere on the internet and satisfy the network factor
// outright. Campus Wi-Fi names are public information, which made it a one-field bypass of
// the third verification factor. The column survives as a human-readable label for the
// teacher, and the create-session form already describes it as display-only.
function verifyNetwork({ clientIp }, session) {
  if (isIpInSubnet(clientIp, session.authorised_subnet)) {
    return { passed: true };
  }

  return { passed: false, reason: 'NETWORK_UNAUTHORISED' };
}

module.exports = { verifyNetwork };
