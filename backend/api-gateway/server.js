const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration - Allow both common React ports
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'API Gateway is running' });
});

// Proxy configuration
const proxyOptions = {
  changeOrigin: true,
  logLevel: 'debug',
  onError: (err, req, res) => {
    console.error('Proxy Error:', err);
    res.status(500).json({ 
      error: 'Service unavailable',
      message: err.message 
    });
  }
};

// IMPORTANT: Route order matters - more specific routes first!

// Request logging for gateway
app.use((req, res, next) => {
  console.log(`🌐 [${new Date().toISOString()}] Gateway: ${req.method} ${req.path}`);
  next();
});

// Route for CV/ML endpoints and Interview operations - unified under /api/interview
app.use('/api/interview', createProxyMiddleware({
  target: process.env.INTERVIEW_SERVICE_URL || 'http://localhost:5003',
  pathRewrite: {
    '^/api/interview': '/api/interview', // Keep the prefix for Interview Service
  },
  ...proxyOptions,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`   ➜ Forwarding to Interview Service: ${req.method} /api/interview${req.path.replace('/api/interview', '')}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`   ✓ Interview Service responded: ${proxyRes.statusCode}`);
  }
}));

// Legacy route support for /interview/* (CV upload, predict)
app.use('/interview', createProxyMiddleware({
  target: process.env.INTERVIEW_SERVICE_URL || 'http://localhost:5003',
  pathRewrite: {
    '^/interview': '/api/interview', // Redirect to new structure
  },
  ...proxyOptions,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`   ➜ Legacy route /interview/* redirected to Interview Service`);
  }
}));

// Legacy support for /api/interviews/* (old CRUD routes)
app.use('/api/interviews', createProxyMiddleware({
  target: process.env.INTERVIEW_SERVICE_URL || 'http://localhost:5003',
  pathRewrite: {
    '^/api/interviews': '/api/interview', // Redirect to new structure
  },
  ...proxyOptions,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`   ➜ Legacy route /api/interviews/* redirected to Interview Service`);
  }
}));

// Route to Auth Service
app.use('/api/auth', createProxyMiddleware({
  target: process.env.AUTH_SERVICE_URL || 'http://localhost:5001',
  pathRewrite: {
    '^/api/auth': '', // Remove /api/auth prefix
  },
  ...proxyOptions
}));

// Route to User Service
app.use('/api/users', createProxyMiddleware({
  target: process.env.USER_SERVICE_URL || 'http://localhost:5002',
  pathRewrite: {
    '^/api/users': '', // Remove /api/users prefix
  },
  ...proxyOptions
}));

// 404 handler
app.use((req, res) => {
  console.log(`❌ Gateway 404: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found', path: req.path });
});

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log(`📡 Proxying:`);
  console.log(`   /api/auth      → ${process.env.AUTH_SERVICE_URL || 'http://localhost:5001'}`);
  console.log(`   /api/users     → ${process.env.USER_SERVICE_URL || 'http://localhost:5002'}`);
  console.log(`   /api/interview → ${process.env.INTERVIEW_SERVICE_URL || 'http://localhost:5003'} (NEW)`);
  console.log(`   /interview     → ${process.env.INTERVIEW_SERVICE_URL || 'http://localhost:5003'} (Legacy)`);
  console.log(`   /api/interviews → ${process.env.INTERVIEW_SERVICE_URL || 'http://localhost:5003'} (Legacy)`);
});
