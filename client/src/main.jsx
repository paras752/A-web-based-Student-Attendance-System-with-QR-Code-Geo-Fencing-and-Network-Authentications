import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './index.css'
import './styles/theme.css'
import App from './App.jsx'

// Note: StrictMode is intentionally not used here. Its dev-only double-invoke of effects
// conflicts with the QR scanner's camera start/stop lifecycle (ScanAttendance.jsx), which
// talks to a real hardware device rather than being a pure side-effect.
createRoot(document.getElementById('root')).render(<App />)
