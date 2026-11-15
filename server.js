/**
 * PMI FORENSIC CLOCK AR — Local Bridge Server
 * Menghubungkan Unity AR APK (Android) dengan Web Dashboard Laptop secara Real-Time.
 * Tidak memerlukan instalasi package npm tambahan (hanya modul bawaan Node.js).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const PUBLIC_DIR = __dirname;

// Menyimpan koneksi SSE (Server-Sent Events) dari dashboard laptop
const sseClients = new Set();
let latestTelemetry = null;

// Daftar MIME Type untuk static web files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ iface: name, ip: net.address });
      }
    }
  }
  return addresses;
}

const server = http.createServer((req, res) => {
  // Aktifkan CORS agar Web Dashboard bisa terkoneksi dari mana saja
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // ── 1. ENDPOINT TELEMETRY DARI UNITY APK (POST /api/telemetry) ──
  if (req.method === 'POST' && pathname === '/api/telemetry') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        latestTelemetry = {
          ...data,
          tipe: 'UNITY_TELEMETRY',
          receivedAt: new Date().toISOString()
        };

        const timeStr = new Date().toLocaleTimeString('id-ID');
        console.log(`\n=============================================================`);
        console.log(`📡 [${timeStr}] TELEMETRY DITERIMA DARI HP ANDROID!`);
        console.log(`   Kasus       : ${data.caseName || ('Kasus ' + data.caseId)}`);
        console.log(`   Suhu Rektal : ${data.rectalTemp} °C | Suhu Ruang: ${data.ambientTemp} °C`);
        console.log(`   Berat Badan : ${data.bodyWeight} kg | Faktor Koreksi: ${data.correctionFactor}`);
        console.log(`   Temuan AR   : Kepala="${data.headFinding?.substring(0,30)}...", Dada="${data.chestFinding?.substring(0,30)}..."`);
        console.log(`   >> Mengirim ke ${sseClients.size} Web Dashboard di Laptop...`);
        console.log(`=============================================================`);

        // Siarkan secara realtime ke seluruh Web Dashboard yang sedang terbuka
        const payload = `data: ${JSON.stringify(latestTelemetry)}\n\n`;
        sseClients.forEach(client => {
          try {
            client.write(payload);
          } catch (e) {
            sseClients.delete(client);
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          message: 'Telemetry berhasil diterima Server Laptop',
          caseId: data.caseId,
          activeWebClients: sseClients.size
        }));
      } catch (err) {
        console.error('❌ Gagal memproses JSON telemetry:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Format JSON tidak valid' }));
      }
    });
    return;
  }

  // ── 2. ENDPOINT SSE (Server-Sent Events) UNTUK DASHBOARD LAPTOP (/api/events) ──
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ tipe: 'SERVER_HELLO', message: 'Terkoneksi ke Local Bridge Server', port: PORT })}\n\n`);

    // Jika ada data telemetry terakhir, kirim langsung ke client yang baru buka
    if (latestTelemetry) {
      res.write(`data: ${JSON.stringify(latestTelemetry)}\n\n`);
    }

    sseClients.add(res);
    console.log(`[Web Dashboard] Klien baru terhubung via SSE (Total: ${sseClients.size})`);

    req.on('close', () => {
      sseClients.delete(res);
      console.log(`[Web Dashboard] Klien terputus (Total: ${sseClients.size})`);
    });
    return;
  }

  // ── 3. ENDPOINT CEK STATUS & TELEMETRY TERAKHIR (/api/telemetry/last) ──
  if (pathname === '/api/telemetry/last') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(latestTelemetry || { status: 'waiting_data' }));
    return;
  }

  // ── 4. STATIC FILE SERVING (index.html, dashboard.html, mobile.html, assets, dll) ──
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/dashboard.html';
  }
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404: File tidak ditemukan (${pathname})`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('\n=============================================================');
  console.log('   🚀 PMI FORENSIC CLOCK AR — LOCAL SERVER BRIDGE AKTIF!     ');
  console.log('=============================================================');
  console.log(`Port Server     : ${PORT}`);
  console.log(`Buka di Laptop  : http://localhost:${PORT}/dashboard.html`);
  console.log(`                   http://localhost:${PORT}/index.html`);
  console.log('-------------------------------------------------------------');
  console.log('Alamat IP Wi-Fi Laptop:');
  ips.forEach(item => {
    console.log(`  👉 [${item.iface}]: http://${item.ip}:${PORT}/dashboard.html`);
    console.log(`     Target URL Unity: http://${item.ip}:${PORT}/api/telemetry`);
  });
  console.log('-------------------------------------------------------------');
  console.log('Status: MENUNGGU SINYAL TELEMETRY DARI HP / UNITY APK...');
  console.log('=============================================================\n');
});
