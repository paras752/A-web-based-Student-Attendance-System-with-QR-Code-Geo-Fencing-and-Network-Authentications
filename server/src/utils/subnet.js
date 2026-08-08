// Minimal IPv4 CIDR matcher used for network authentication (Section 3.2.5 / 4.9.5).
// Browsers cannot expose the Wi-Fi SSID to JavaScript, so the automated check that can
// actually be implemented client-side-free is: does the request's source IP fall inside
// the institution's authorised subnet? The session's `authorised_ssid` field is kept only
// as a human-readable label for the teacher; it is not used as an automated signal.

// Loopback used to be treated as authorised unconditionally, which had two problems: it
// silently disabled the third verification factor for anything reaching the server locally,
// and it was inconsistent - '::1' passed while '127.0.0.1' did not, so the same machine
// could pass or fail depending on which stack the connection arrived over. Dev convenience
// is served by the 'any' subnet (the default for both CAMPUS_SUBNET and new sessions), so
// this is now opt-in and off by default.
const TRUST_LOOPBACK =
  String(process.env.NETWORK_TRUST_LOOPBACK || 'false').toLowerCase() === 'true';

const LOOPBACK = new Set(['::1', '127.0.0.1', 'localhost']);

function normaliseIp(ip) {
  if (!ip) return ip;
  // Express/Node report IPv4-over-IPv6 connections as e.g. "::ffff:127.0.0.1"
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : ip;
}

function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// subnet like "192.168.1.0/24"; special-cased "any"/"0.0.0.0/0" allows all (useful for
// local dev where the real institutional subnet isn't reachable).
function isIpInSubnet(ip, subnet) {
  if (!ip || !subnet) return false;
  if (subnet.trim().toLowerCase() === 'any') return true;

  const cleanIp = normaliseIp(ip);
  if (TRUST_LOOPBACK && LOOPBACK.has(cleanIp)) {
    return true;
  }

  const [rangeIp, prefixStr] = subnet.split('/');
  const prefix = prefixStr === undefined ? 32 : Number(prefixStr);

  const ipInt = ipToInt(cleanIp);
  const rangeInt = ipToInt(rangeIp);
  if (ipInt === null || rangeInt === null) return false;

  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

module.exports = { isIpInSubnet, normaliseIp };
