const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const interviewRoutes = require('./routes/interviewRoutes');

const app = express();
const PORT = process.env.PORT || 5003;

// Middleware
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log(`   Headers: Authorization=${req.headers.authorization ? 'Present' : 'Missing'}`);
  console.log(`   Body keys: ${Object.keys(req.body).join(', ') || 'Empty'}`);
  next();
});

// Health check (must come BEFORE other routes)
app.get('/health', (req, res) => {
  res.json({ status: 'Interview Service is running' });
});

// Database connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ Interview Service connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// Routes - Mount with /api/interview prefix for consistency
app.use('/api/interview', interviewRoutes);

// Legacy route support - redirect old routes to new prefix
app.use('/', (req, res, next) => {
  // If request doesn't start with /api/interview and isn't /health
  if (!req.path.startsWith('/api/interview') && req.path !== '/health') {
    console.log(`⚠️  Legacy route accessed: ${req.path} - redirecting to /api/interview${req.path}`);
    // Forward to the new route structure
    req.url = `/api/interview${req.path}`;
    return app.handle(req, res);
  }
  next();
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method,
    availableRoutes: [
      'GET /health',
      'GET /api/interview',
      'POST /api/interview',
      'POST /api/interview/submit',
      'POST /api/interview/predict',
      'POST /api/interview/upload-cv',
      'POST /api/interview/generate-questions',
      'GET /api/interview/:id',
      'GET /api/interview/:id/feedback',
      'PUT /api/interview/:id',
      'DELETE /api/interview/:id'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

app.listen(PORT, () => {
  const aiBase = process.env.AI_API_BASE_URL || process.env.AI_SERVICE_URL || 'http://localhost:8000';
  console.log(`Interview Service running on port ${PORT}`);
  console.log(`All interview routes mounted at: /api/interview/*`);
  console.log(`AI backend:                   ${aiBase}`);
  console.log(`Routes:`);
  console.log(`   POST /api/interview/predict             -> AI /analyze-cv + /generate-questions`);
  console.log(`   POST /api/interview/upload-cv           -> AI /analyze-cv`);
  console.log(`   POST /api/interview/generate-questions  -> AI /generate-questions`);
  console.log(`   POST /api/interview/analyze-video       -> AI /analyze-video`);
  console.log(`   POST /api/interview/submit              -> AI /complete-interview`);
  console.log(`   GET  /api/interview/:id/feedback`);
});
