const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');

// Multer storage for CV uploads (kept in user-service/uploads/)
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const cvUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
    }
  },
});

// Profile
router.get ('/profile', authMiddleware, userController.getProfile);
router.put ('/profile', authMiddleware, userController.updateProfile);

// Stats (computed from interview collection)
router.get ('/stats',   authMiddleware, userController.getUserStats);

// Allow token via query string for file downloads (browser <a href> / window.open)
const tokenFromQuery = (req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
};

// CV management
router.get   ('/cvs',                                          authMiddleware, userController.getCVs);
router.post  ('/cvs', cvUpload.single('cv_file'),              authMiddleware, userController.uploadCV);
router.delete('/cvs/:fileId',                                  authMiddleware, userController.deleteCV);
router.get   ('/cvs/:fileId/download', tokenFromQuery,         authMiddleware, userController.downloadCV);

// Settings
router.get('/settings', authMiddleware, userController.getSettings);
router.put('/settings', authMiddleware, userController.updateSettings);

module.exports = router;
