const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(express.json());

// Database connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ Auth Service connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// Routes
app.use('/', authRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Auth Service is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

app.listen(PORT, () => {
  console.log(`🔐 Auth Service running on port ${PORT}`);
});
