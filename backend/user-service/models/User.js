const mongoose = require('mongoose');

const cvFileSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  filename: { type: String, required: true }, // stored name on disk
  size: { type: Number, default: 0 },
  uploadDate: { type: Date, default: Date.now },
}, { _id: true });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required']
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  bio: {
    type: String,
    trim: true,
    default: ''
  },
  avatar: {
    type: String, // base64 data-URL or relative path
    default: ''
  },
  settings: {
    emailNotifications: { type: Boolean, default: true },
    weeklyReports:      { type: Boolean, default: true },
    interviewReminders: { type: Boolean, default: false },
  },
  cvFiles: [cvFileSchema],
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
