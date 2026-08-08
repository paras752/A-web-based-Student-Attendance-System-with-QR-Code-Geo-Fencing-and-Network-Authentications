import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `npm run dev:lan` serves the app over HTTPS on the machine's LAN address so a phone can
// reach it. HTTPS is not optional there: getUserMedia (the QR scanner's camera) and
// geolocation are both gated behind a secure context, and a plain http://192.168.x.x
// origin is not one - the camera silently refuses to start. localhost is exempt from that
// rule, which is why the ordinary `npm run dev` needs none of this.
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const lan = mode === 'lan'

  return {
    plugins: [react(), ...(lan ? [basicSsl()] : [])],
    server: {
      port: 5173,
      host: lan,
      proxy: {
        // The proxy runs in the dev server process, so it still reaches the API over
        // plain HTTP on loopback even when the browser-facing side is HTTPS. That also
        // keeps the phone on a single origin, so the httpOnly refresh cookie works.
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
        },
      },
    },
  }
})
