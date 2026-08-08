import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { CheckCircle2, MapPin, QrCode, Wifi, XCircle } from 'lucide-react';
import api from '../../api/client';
import AppShell from '../../components/AppShell';

const SCANNER_ELEMENT_ID = 'qr-reader';

const FAILURE_MESSAGES = {
  SESSION_INACTIVE: 'This session has ended or has not started yet.',
  QR_EXPIRED: 'That QR code has expired. Ask your teacher to refresh the screen and scan again.',
  QR_INVALID: 'That QR code is not valid for this system.',
  GEOFENCE_MISSING_COORDINATES: 'Could not read your location. Please allow location access and try again.',
  GEOFENCE_OUT_OF_RANGE: 'You appear to be outside the classroom area, so attendance was not recorded.',
  NETWORK_UNAUTHORISED: 'Your device is not on the authorised institutional network.',
  DUPLICATE_SUBMISSION: 'You have already checked in for this session.',
};

// Maps a server failure reason back onto the 3-step verification checklist so the UI can show
// exactly which check failed, rather than a single opaque error message (Section 4.9.2 order:
// QR, then geofence, then network — a step never runs after an earlier one has already failed).
const STEP_OUTCOME_BY_REASON = {
  SESSION_INACTIVE: { qr: 'failed', geofence: 'skipped', network: 'skipped' },
  QR_EXPIRED: { qr: 'failed', geofence: 'skipped', network: 'skipped' },
  QR_INVALID: { qr: 'failed', geofence: 'skipped', network: 'skipped' },
  GEOFENCE_MISSING_COORDINATES: { qr: 'passed', geofence: 'failed', network: 'skipped' },
  GEOFENCE_OUT_OF_RANGE: { qr: 'passed', geofence: 'failed', network: 'skipped' },
  NETWORK_UNAUTHORISED: { qr: 'passed', geofence: 'passed', network: 'failed' },
  DUPLICATE_SUBMISSION: { qr: 'passed', geofence: 'passed', network: 'passed' },
};

const STEP_META = {
  pending: { label: 'Pending', cls: 'md-badge-neutral' },
  verifying: { label: 'Checking', cls: 'md-badge-primary' },
  passed: { label: 'Passed', cls: 'md-badge-success' },
  failed: { label: 'Failed', cls: 'md-badge-error' },
  skipped: { label: 'Skipped', cls: 'md-badge-neutral' },
};

// html5-qrcode throws "Cannot stop, scanner is not running or paused" SYNCHRONOUSLY, so a
// trailing .catch() on the returned promise never sees it - the error escapes as an unhandled
// exception and, from a React effect cleanup, takes the page down with it. That happens on
// every ordinary path where the camera never started: permission denied, no camera present,
// or the student navigating away while start() is still resolving.
async function stopScannerQuietly(scanner) {
  if (!scanner) return;
  try {
    const state = typeof scanner.getState === 'function' ? scanner.getState() : null;
    const running =
      state === null ||
      state === Html5QrcodeScannerState.SCANNING ||
      state === Html5QrcodeScannerState.PAUSED;
    if (!running) return;
    await scanner.stop();
  } catch {
    /* already stopped, or never started - nothing to clean up either way */
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

function ChecklistStep({ icon: Icon, label, state }) {
  const meta = STEP_META[state];
  return (
    <div className="md-card md-card-filled d-flex align-items-center justify-content-between" style={{ padding: 16 }}>
      <div className="d-flex align-items-center gap-3">
        <Icon size={20} style={{ color: 'var(--md-on-surface-variant)' }} />
        <span className="md-title-small" style={{ color: 'var(--md-on-surface)' }}>
          {label}
        </span>
      </div>
      <span className={`md-badge ${meta.cls}`}>{meta.label}</span>
    </div>
  );
}

export default function ScanAttendance() {
  const scannerRef = useRef(null);
  const [status, setStatus] = useState('scanning'); // scanning | processing | success | error
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState(null);
  const [steps, setSteps] = useState({ qr: 'pending', geofence: 'pending', network: 'pending' });

  useEffect(() => {
    if (status !== 'scanning') return undefined;

    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;
    let stopped = false;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        async (decodedText) => {
          if (stopped) return;
          stopped = true;
          await stopScannerQuietly(scanner);
          handleDecoded(decodedText);
        },
        () => {
          /* per-frame decode misses are expected while aiming the camera; ignore */
        }
      )
      .catch((err) => {
        setStatus('error');
        setMessage(
          'Could not access the camera: ' +
            (err?.message || err) +
            '. Check that you granted camera permission and that the page is on https.'
        );
      });

    return () => {
      stopped = true;
      stopScannerQuietly(scanner);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleDecoded = async (decodedText) => {
    setStatus('processing');
    setMessage('Reading your location…');
    setDetail(null);
    setSteps({ qr: 'pending', geofence: 'pending', network: 'pending' });

    let qrPayload;
    try {
      qrPayload = JSON.parse(decodedText);
    } catch (err) {
      setStatus('error');
      setMessage('That does not look like a valid SSAS QR code.');
      setSteps({ qr: 'failed', geofence: 'skipped', network: 'skipped' });
      return;
    }

    setSteps({ qr: 'verifying', geofence: 'pending', network: 'pending' });

    let position;
    try {
      position = await getCurrentPosition();
    } catch (err) {
      setStatus('error');
      setMessage('Location access is required to check in: ' + err.message);
      setSteps({ qr: 'passed', geofence: 'failed', network: 'skipped' });
      return;
    }

    setSteps({ qr: 'passed', geofence: 'verifying', network: 'pending' });
    setMessage('Submitting attendance…');
    try {
      const { data } = await api.post('/attendance/verify', {
        qrPayload,
        coordinates: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        },
      });
      setStatus('success');
      setMessage('Attendance recorded');
      setDetail(data);
      setSteps({ qr: 'passed', geofence: 'passed', network: 'passed' });
    } catch (err) {
      const reason = err.response?.data?.error?.message;
      setStatus('error');
      setMessage(FAILURE_MESSAGES[reason] || err.response?.data?.error?.message || 'Attendance verification failed.');
      setDetail(err.response?.data?.error?.details || null);
      setSteps(STEP_OUTCOME_BY_REASON[reason] || { qr: 'passed', geofence: 'passed', network: 'failed' });
    }
  };

  const handleRetry = () => {
    setStatus('scanning');
    setMessage('');
    setDetail(null);
    setSteps({ qr: 'pending', geofence: 'pending', network: 'pending' });
  };

  return (
    <AppShell title="Check in">
      <div className="mx-auto" style={{ maxWidth: 520 }}>
        <h2 className="md-headline-small text-center mb-1" style={{ color: 'var(--md-on-surface)' }}>
          Scan attendance code
        </h2>
        <p className="md-body-medium text-center mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
          Point your camera at the QR code on the classroom screen.
        </p>

        {status === 'scanning' && (
          <div
            id={SCANNER_ELEMENT_ID}
            className="mx-auto overflow-hidden mb-4"
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              borderRadius: 'var(--md-shape-xl)',
              background: 'var(--md-surface-container-highest)',
              border: '2px solid var(--md-outline-variant)',
            }}
          />
        )}

        {status !== 'scanning' && (
          <>
            <div
              className={`md-card md-card-pad text-center mb-4 ${
                status === 'success' ? 'md-card-filled' : 'md-card-outlined'
              }`}
            >
              {status === 'success' ? (
                <CheckCircle2 size={48} style={{ color: 'var(--md-success)' }} className="mb-3" />
              ) : status === 'error' ? (
                <XCircle size={48} style={{ color: 'var(--md-error)' }} className="mb-3" />
              ) : (
                <div className="md-spinner mx-auto mb-3" role="status" />
              )}
              <h3 className="md-title-large mb-1" style={{ color: 'var(--md-on-surface)' }}>
                {message}
              </h3>
              {detail?.distanceMeters !== undefined && (
                <p className="md-body-small mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                  {Math.round(detail.distanceMeters)} m from the classroom
                </p>
              )}
            </div>

            <div className="d-flex flex-column gap-2 mb-4">
              <ChecklistStep icon={QrCode} label="QR code valid" state={steps.qr} />
              <ChecklistStep icon={MapPin} label="Inside classroom" state={steps.geofence} />
              <ChecklistStep icon={Wifi} label="Institutional network" state={steps.network} />
            </div>
          </>
        )}

        {(status === 'success' || status === 'error') && (
          <button type="button" className="md-btn md-btn-filled md-btn-block mb-3" onClick={handleRetry}>
            {status === 'success' ? 'Scan another' : 'Try again'}
          </button>
        )}

        <p className="md-body-small text-center" style={{ color: 'var(--md-on-surface-variant)' }}>
          Your camera and location are only used at the moment you scan. All three checks must pass
          for attendance to be recorded.
        </p>

        <div className="text-center">
          <Link to="/student" className="md-btn md-btn-text">
            Back to dashboard
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
