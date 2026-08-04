import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../../api/client';

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

export default function ScanAttendance() {
  const scannerRef = useRef(null);
  const [status, setStatus] = useState('scanning'); // scanning | processing | success | error
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState(null);

  useEffect(() => {
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
          await scanner.stop().catch(() => {});
          handleDecoded(decodedText);
        },
        () => {
          /* per-frame decode misses are expected while aiming the camera; ignore */
        }
      )
      .catch((err) => {
        setStatus('error');
        setMessage('Could not access the camera: ' + err.message);
      });

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDecoded = async (decodedText) => {
    setStatus('processing');
    setMessage('Reading your location…');
    setDetail(null);

    let qrPayload;
    try {
      qrPayload = JSON.parse(decodedText);
    } catch (err) {
      setStatus('error');
      setMessage('That does not look like a valid SSAS QR code.');
      return;
    }

    let position;
    try {
      position = await getCurrentPosition();
    } catch (err) {
      setStatus('error');
      setMessage('Location access is required to check in: ' + err.message);
      return;
    }

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
      setMessage('Attendance recorded!');
      setDetail(data);
    } catch (err) {
      const reason = err.response?.data?.error?.message;
      setStatus('error');
      setMessage(FAILURE_MESSAGES[reason] || err.response?.data?.error?.message || 'Attendance verification failed.');
      setDetail(err.response?.data?.error?.details || null);
    }
  };

  const handleRetry = () => {
    setStatus('scanning');
    setMessage('');
    setDetail(null);
  };

  return (
    <div className="container py-4" style={{ maxWidth: 480 }}>
      <h4 className="mb-3">Scan attendance QR code</h4>

      {status === 'scanning' && (
        <div id={SCANNER_ELEMENT_ID} className="border rounded overflow-hidden" />
      )}

      {status !== 'scanning' && (
        <div
          className={`alert ${
            status === 'success' ? 'alert-success' : status === 'error' ? 'alert-danger' : 'alert-info'
          }`}
        >
          {message}
          {detail?.distanceMeters !== undefined && (
            <div className="small mt-1">Distance from classroom: {Math.round(detail.distanceMeters)}m</div>
          )}
        </div>
      )}

      {(status === 'success' || status === 'error') && (
        <button className="btn btn-primary" onClick={handleRetry}>
          {status === 'success' ? 'Scan another' : 'Try again'}
        </button>
      )}

      <p className="text-muted small mt-3">
        Your camera and location are only used at the moment you scan, to prove you are physically
        in the classroom for this session.
      </p>
    </div>
  );
}
