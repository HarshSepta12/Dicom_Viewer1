// server-minimal.js - SIMPLIFIED VERSION
import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 5000;

// Simple CORS
app.use(cors({ origin: '*' }));
app.use(express.json());

// Credentials endpoint
app.get('/api/credentials', (req, res) => {
  res.json({ username: 'harsh', password: '12345' });
});

// Orthanc proxy
app.use('/orthanc', createProxyMiddleware({
  target: 'http://localhost:8042',
  changeOrigin: true,
  pathRewrite: { '^/orthanc': '' },
  onProxyReq: (proxyReq) => {
    const auth = Buffer.from('harsh:12345').toString('base64');
    proxyReq.setHeader('Authorization', `Basic ${auth}`);
  }
}));

// Static files
app.use(express.static(__dirname));

// Simple fallback
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
