const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const userRoutes = require('./routes/userRoutes');

const app = express();
const PORT = process.env.PORT || 5002;

// Middleware
app.use(express.json());

// Database connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ User Service connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// Routes
app.use('/', userRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'User Service is running' });
});

// Error handling middleware (covers multer errors too)
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 10 MB)' });
  }
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`👤 User Service running on port ${PORT}`);
});
