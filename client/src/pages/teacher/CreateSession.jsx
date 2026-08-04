import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';

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
    geofenceLat: '',
    geofenceLng: '',
    geofenceRadiusM: 50,
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
        geofenceLat: Number(form.geofenceLat),
        geofenceLng: Number(form.geofenceLng),
        geofenceRadiusM: Number(form.geofenceRadiusM),
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
    <div className="container py-4" style={{ maxWidth: 560 }}>
      <h4 className="mb-3">Start a new attendance session</h4>
      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="card card-body">
        <div className="row g-2 mb-2">
          <div className="col">
            <label className="form-label">Geofence centre latitude</label>
            <input
              className="form-control"
              name="geofenceLat"
              value={form.geofenceLat}
              onChange={handleChange}
              required
            />
          </div>
          <div className="col">
            <label className="form-label">Geofence centre longitude</label>
            <input
              className="form-control"
              name="geofenceLng"
              value={form.geofenceLng}
              onChange={handleChange}
              required
            />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm mb-3"
          onClick={handleUseMyLocation}
          disabled={locating}
        >
          {locating ? 'Locating…' : '📍 Use my current location as classroom centre'}
        </button>

        <div className="mb-2">
          <label className="form-label">Geofence radius (metres)</label>
          <input
            type="number"
            className="form-control"
            name="geofenceRadiusM"
            value={form.geofenceRadiusM}
            onChange={handleChange}
            min={10}
            max={500}
          />
        </div>

        <div className="mb-2">
          <label className="form-label">Authorised network label (SSID, optional)</label>
          <input
            className="form-control"
            name="authorisedSsid"
            placeholder="e.g. Campus-WiFi"
            value={form.authorisedSsid}
            onChange={handleChange}
          />
          <div className="form-text">
            For display only — browsers can't read a device's Wi-Fi SSID, so the actual network
            check below matches the student's IP subnet.
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label">Authorised subnet (CIDR)</label>
          <input
            className="form-control"
            name="authorisedSubnet"
            placeholder="e.g. 192.168.1.0/24, or 'any' for local testing"
            value={form.authorisedSubnet}
            onChange={handleChange}
            required
          />
        </div>

        <div className="row g-2 mb-3">
          <div className="col">
            <label className="form-label">Start time</label>
            <input
              type="datetime-local"
              className="form-control"
              name="startTime"
              value={form.startTime}
              onChange={handleChange}
              required
            />
          </div>
          <div className="col">
            <label className="form-label">End time</label>
            <input
              type="datetime-local"
              className="form-control"
              name="endTime"
              value={form.endTime}
              onChange={handleChange}
              required
            />
          </div>
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Starting…' : 'Start session'}
        </button>
      </form>
    </div>
  );
}
