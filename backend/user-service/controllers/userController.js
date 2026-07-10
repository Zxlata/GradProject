const path = require('path');
const fs   = require('fs');
const User = require('../models/User');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function safeUnlink(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

// ---------------------------------------------------------------------------
// GET /profile
// ---------------------------------------------------------------------------
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.status(200).json({
      id:       user._id,
      name:     user.name,
      email:    user.email,
      phone:    user.phone  || '',
      bio:      user.bio    || '',
      avatar:   user.avatar || '',
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error('getProfile error:', err);
    res.status(500).json({ error: 'Error fetching profile', message: err.message });
  }
};

// ---------------------------------------------------------------------------
// PUT /profile  – update name / phone / bio / avatar
// ---------------------------------------------------------------------------
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, bio, avatar } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (name  !== undefined) user.name  = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (bio   !== undefined) user.bio   = bio.trim();
    if (avatar !== undefined) user.avatar = avatar; // base64 data-URL

    await user.save();

    res.status(200).json({
      id:     user._id,
      name:   user.name,
      email:  user.email,
      phone:  user.phone,
      bio:    user.bio,
      avatar: user.avatar,
    });
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({ error: 'Error updating profile', message: err.message });
  }
};

// ---------------------------------------------------------------------------
// GET /stats  – compute real stats from interview-service via shared DB
// ---------------------------------------------------------------------------
exports.getUserStats = async (req, res) => {
  try {
    // We share the same MongoDB instance, so we can query the Interview
    // collection directly without an HTTP call to interview-service.
    // Lazy-require to avoid a hard dependency on the Interview model path.
    // If the model is already registered (same process), use it; otherwise
    // define a minimal schema just for the aggregation query.
    let Interview;
    try {
      Interview = require('mongoose').model('Interview');
    } catch (_) {
      const mongoose = require('mongoose');
      const schema = new mongoose.Schema({}, { strict: false });
      Interview = mongoose.model('Interview', schema, 'interviews');
    }

    const mongoose = require('mongoose');
    const userId = new mongoose.Types.ObjectId(req.userId);

    const [agg] = await Interview.aggregate([
      { $match: { userId, status: 'completed' } },
      {
        $group: {
          _id: null,
          total:       { $sum: 1 },
          totalTime:   { $sum: '$performance.timeSpent' },
          avgScore:    { $avg: '$aiAnalysis.matchScore' },
          bestScore:   { $max: '$aiAnalysis.matchScore' },
          scores:      { $push: { score: '$aiAnalysis.matchScore', date: '$createdAt' } },
        }
      }
    ]);

    if (!agg) {
      return res.status(200).json({
        totalInterviews: 0,
        averageScore:    0,
        bestScore:       0,
        practiceTime:    '0h 0m',
        practiceSeconds: 0,
        chartData:       [],
      });
    }

    const totalSec  = agg.totalTime  || 0;
    const hours     = Math.floor(totalSec / 3600);
    const minutes   = Math.floor((totalSec % 3600) / 60);
    const practiceTime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    // Build chart data: last 10 completed interviews, oldest first
    const chartData = (agg.scores || [])
      .filter(s => s.score != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-10)
      .map(s => ({
        date:  s.date,
        score: Math.round(s.score),
      }));

    res.status(200).json({
      totalInterviews: agg.total       || 0,
      averageScore:    Math.round(agg.avgScore  || 0),
      bestScore:       Math.round(agg.bestScore || 0),
      practiceTime,
      practiceSeconds: totalSec,
      chartData,
    });
  } catch (err) {
    console.error('getUserStats error:', err);
    res.status(500).json({ error: 'Error fetching stats', message: err.message });
  }
};

// ---------------------------------------------------------------------------
// CV file management
// ---------------------------------------------------------------------------

// GET /cvs
exports.getCVs = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('cvFiles');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json({ cvFiles: user.cvFiles || [] });
  } catch (err) {
    console.error('getCVs error:', err);
    res.status(500).json({ error: 'Error fetching CVs', message: err.message });
  }
};

// POST /cvs  (multer puts file at req.file)
exports.uploadCV = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    ensureUploadsDir();
    const user = await User.findById(req.userId);
    if (!user) {
      safeUnlink(req.file.path);
      return res.status(404).json({ error: 'User not found' });
    }

    user.cvFiles.push({
      originalName: req.file.originalname,
      filename:     req.file.filename,
      size:         req.file.size,
      uploadDate:   new Date(),
    });
    await user.save();

    const saved = user.cvFiles[user.cvFiles.length - 1];
    res.status(201).json({ cvFile: saved });
  } catch (err) {
    safeUnlink(req.file?.path);
    console.error('uploadCV error:', err);
    res.status(500).json({ error: 'Error uploading CV', message: err.message });
  }
};

// DELETE /cvs/:fileId
exports.deleteCV = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const cvFile = user.cvFiles.id(req.params.fileId);
    if (!cvFile) return res.status(404).json({ error: 'CV not found' });

    const diskPath = path.join(UPLOADS_DIR, cvFile.filename);
    safeUnlink(diskPath);

    user.cvFiles.pull(req.params.fileId);
    await user.save();

    res.status(200).json({ message: 'CV deleted successfully' });
  } catch (err) {
    console.error('deleteCV error:', err);
    res.status(500).json({ error: 'Error deleting CV', message: err.message });
  }
};

// GET /cvs/:fileId/download
exports.downloadCV = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('cvFiles');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const cvFile = user.cvFiles.id(req.params.fileId);
    if (!cvFile) return res.status(404).json({ error: 'CV not found' });

    const diskPath = path.join(UPLOADS_DIR, cvFile.filename);
    if (!fs.existsSync(diskPath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    res.download(diskPath, cvFile.originalName);
  } catch (err) {
    console.error('downloadCV error:', err);
    res.status(500).json({ error: 'Error downloading CV', message: err.message });
  }
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// GET /settings
exports.getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('settings');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.status(200).json({
      emailNotifications: user.settings?.emailNotifications ?? true,
      weeklyReports:      user.settings?.weeklyReports      ?? true,
      interviewReminders: user.settings?.interviewReminders ?? false,
    });
  } catch (err) {
    console.error('getSettings error:', err);
    res.status(500).json({ error: 'Error fetching settings', message: err.message });
  }
};

// PUT /settings
exports.updateSettings = async (req, res) => {
  try {
    const { emailNotifications, weeklyReports, interviewReminders } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (emailNotifications !== undefined) user.settings.emailNotifications = Boolean(emailNotifications);
    if (weeklyReports      !== undefined) user.settings.weeklyReports      = Boolean(weeklyReports);
    if (interviewReminders !== undefined) user.settings.interviewReminders = Boolean(interviewReminders);

    await user.save();
    res.status(200).json({
      emailNotifications: user.settings.emailNotifications,
      weeklyReports:      user.settings.weeklyReports,
      interviewReminders: user.settings.interviewReminders,
    });
  } catch (err) {
    console.error('updateSettings error:', err);
    res.status(500).json({ error: 'Error updating settings', message: err.message });
  }
};
