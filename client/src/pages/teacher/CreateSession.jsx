import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapPin, QrCode, Radio, ShieldCheck } from 'lucide-react';
import api from '../../api/client';
import AppShell from '../../components/AppShell';

function toLocalDateTimeInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default function CreateSession() {
  const { courseId } = useParams();
  const navigate = useNavigate();

  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);

  const [form, setForm] = useState({
    room: '',
    geofenceLat: '',
    geofenceLng: '',
    geofenceRadiusM: 50,
    qrValiditySeconds: 30,
    authorisedSsid: '',
    authorisedSubnet: 'any',
    startTime: toLocalDateTimeInputValue(now),
    endTime: toLocalDateTimeInputValue(inOneHour),
  });
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleUseMyLocation = () => {
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((f) => ({
          ...f,
          geofenceLat: position.coords.latitude.toFixed(6),
          geofenceLng: position.coords.longitude.toFixed(6),
        }));
        setLocating(false);
      },
      (err) => {
        setError('Could not get your location: ' + err.message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const { data } = await api.post('/sessions', {
        courseId: Number(courseId),
        room: form.room || undefined,
        geofenceLat: Number(form.geofenceLat),
        geofenceLng: Number(form.geofenceLng),
        geofenceRadiusM: Number(form.geofenceRadiusM),
        qrValiditySeconds: Number(form.qrValiditySeconds),
        authorisedSsid: form.authorisedSsid || undefined,
        authorisedSubnet: form.authorisedSubnet,
        startTime: new Date(form.startTime).toISOString(),
        endTime: new Date(form.endTime).toISOString(),
      });
      navigate(`/teacher/session/${data.session.id}/live`);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create session');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell title="New session">
      <div className="mx-auto" style={{ maxWidth: 780 }}>
        <h2 className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
          Create attendance session
        </h2>
        <p className="md-body-medium mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
          Configure the verification rules students must satisfy to check in.
        </p>

        {error && (
          <div className="md-banner md-banner-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="md-card md-card-elevated md-card-pad mb-4">
            <div className="d-flex align-items-center gap-2 mb-4">
              <MapPin size={20} style={{ color: 'var(--md-primary)' }} />
              <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                Classroom location
              </h3>
            </div>

            <div className="md-field">
              <label className="md-field-label" htmlFor="s-room">Room</label>
              <input
                id="s-room"
                className="md-input"
                name="room"
                placeholder="e.g. Room 402"
                maxLength={40}
                value={form.room}
                onChange={handleChange}
              />
              <span className="md-supporting">
                Shown on your schedule and to students. The coordinates below are what the
                geofence actually checks.
              </span>
            </div>

            <div className="row g-3">
              <div className="col-md-6">
                <div className="md-field">
                  <label className="md-field-label" htmlFor="s-lat">Latitude</label>
                  <input
                    id="s-lat"
                    className="md-input"
                    name="geofenceLat"
                    value={form.geofenceLat}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
              <div className="col-md-6">
                <div className="md-field">
                  <label className="md-field-label" htmlFor="s-lng">Longitude</label>
                  <input
                    id="s-lng"
                    className="md-input"
                    name="geofenceLng"
                    value={form.geofenceLng}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              className="md-btn md-btn-tonal mb-4"
              onClick={handleUseMyLocation}
              disabled={locating}
            >
              <MapPin size={16} /> {locating ? 'Locating…' : 'Use my current location'}
            </button>

            <div className="md-field mb-0">
              <label className="md-field-label" htmlFor="s-radius">Geofence radius (metres)</label>
              <input
                id="s-radius"
                type="number"
                className="md-input"
                name="geofenceRadiusM"
                value={form.geofenceRadiusM}
                onChange={handleChange}
                min={10}
                max={500}
              />
              <span className="md-supporting">Students must be within this distance to check in.</span>
            </div>
          </div>

          <div className="md-card md-card-elevated md-card-pad mb-4">
            <div className="d-flex align-items-center gap-2 mb-4">
              <QrCode size={20} style={{ color: 'var(--md-primary)' }} />
              <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                QR code
              </h3>
            </div>

            <div className="md-field mb-0">
              <label className="md-field-label" htmlFor="s-qr">Code expires after (seconds)</label>
              <input
                id="s-qr"
                type="number"
                className="md-input"
                name="qrValiditySeconds"
                value={form.qrValiditySeconds}
                onChange={handleChange}
                min={10}
                max={300}
                step={5}
              />
              <span className="md-supporting">
                The code on screen replaces itself this often, and a scanned code is refused once
                it is this old. Shorter is safer — a photo of the screen stops working sooner —
                but leave enough time for students at the back to aim their camera. 30 seconds
                suits most rooms; a large hall may want 60.
              </span>
              {Number(form.qrValiditySeconds) > 120 && (
                <div className="md-banner md-banner-warning mt-3 mb-0">
                  <span>
                    At {form.qrValiditySeconds} seconds, a photograph of the screen stays usable
                    for {Math.round(Number(form.qrValiditySeconds) / 60)} minute
                    {Number(form.qrValiditySeconds) >= 120 ? 's' : ''} — long enough to send to
                    someone who is not in the room.
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="md-card md-card-elevated md-card-pad mb-4">
            <div className="d-flex align-items-center gap-2 mb-4">
              <ShieldCheck size={20} style={{ color: 'var(--md-primary)' }} />
              <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                Network &amp; schedule
              </h3>
            </div>

            <div className="md-field">
              <label className="md-field-label" htmlFor="s-ssid">Authorised network label (optional)</label>
              <input
                id="s-ssid"
                className="md-input"
                name="authorisedSsid"
                placeholder="e.g. Campus-WiFi"
                value={form.authorisedSsid}
                onChange={handleChange}
              />
              <span className="md-supporting">
                Display only — browsers can't read a device's Wi-Fi SSID, so the real check uses the
                IP subnet below.
              </span>
            </div>

            <div className="md-field">
              <label className="md-field-label" htmlFor="s-subnet">Authorised subnet (CIDR)</label>
              <input
                id="s-subnet"
                className="md-input"
                name="authorisedSubnet"
                placeholder="e.g. 192.168.1.0/24, or 'any' for local testing"
                value={form.authorisedSubnet}
                onChange={handleChange}
                required
              />
            </div>

            <div className="row g-3">
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="s-start">Start time</label>
                  <input
                    id="s-start"
                    type="datetime-local"
                    className="md-input"
                    name="startTime"
                    value={form.startTime}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="s-end">End time</label>
                  <input
                    id="s-end"
                    type="datetime-local"
                    className="md-input"
                    name="endTime"
                    value={form.endTime}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="d-flex gap-2 justify-content-end">
            <button type="button" className="md-btn md-btn-text" onClick={() => navigate('/teacher')}>
              Cancel
            </button>
            <button className="md-btn md-btn-filled" type="submit" disabled={submitting}>
              <Radio size={18} /> {submitting ? 'Starting…' : 'Start session'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
