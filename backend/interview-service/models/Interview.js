const mongoose = require('mongoose');

const interviewSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'User ID is required'],
    ref: 'User'
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true
  },
  company: {
    type: String,
    trim: true
  },
  date: {
    type: Date
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending'
  },
  notes: {
    type: String
  },
  // Interview Type
  interviewType: {
    type: String,
    enum: ['hr', 'technical', 'behavioral', 'general', 'mixed'],
    default: 'general'
  },
  // Questions and Answers
  questions: [{
    text: String,
    category: String,
    id: String
  }],
  answers: [{
    questionId: String,
    questionText: String,
    answer: String,
    timestamp: Date,
    skipped: {
      type: Boolean,
      default: false
    },
    // ---------------------------------------------------------------
    // Multimodal analysis (Phase 3 - Part A). All fields are optional
    // and additive; existing documents continue to read/write fine.
    // ---------------------------------------------------------------
    audio_metrics:       { type: mongoose.Schema.Types.Mixed, default: undefined },
    video_metrics:       { type: mongoose.Schema.Types.Mixed, default: undefined },
    transcript:          { type: String, default: undefined },
    recordingMime:       { type: String, default: undefined },
    recordingDurationMs: { type: Number, default: undefined },
    // Emotion analysis — wav2vec2 (speech) and DeepFace (facial).
    // Shape from AI: { dominant, confidence, source, distribution?, stability? }
    audio_emotion:       { type: mongoose.Schema.Types.Mixed, default: undefined },
    video_emotion:       { type: mongoose.Schema.Types.Mixed, default: undefined }
  }],
  // Performance Metrics
  performance: {
    totalQuestions: {
      type: Number,
      default: 0
    },
    answeredQuestions: {
      type: Number,
      default: 0
    },
    skippedQuestions: {
      type: Number,
      default: 0
    },
    completionRate: {
      type: Number,
      default: 0
    },
    timeSpent: {
      type: Number, // in seconds
      default: 0
    },
    averageAnswerLength: {
      type: Number,
      default: 0
    },
    confidence: {
      type: Number, // 1-5 scale
      default: 0
    }
  },
  // AI Analysis
  aiAnalysis: {
    matchScore: Number,
    skillsIdentified: [String],
    experienceLevel: String,
    strengths: [String],
    areasForImprovement: [String],
    overallFeedback: String,
    detailedScores: [mongoose.Schema.Types.Mixed], // Array of detailed answer scores from AI
    // ---------------------------------------------------------------
    // Multimodal session-level analysis (Phase 3 - Part A). Optional,
    // additive; older documents lacking these fields keep working.
    // ---------------------------------------------------------------
    avgAudioMetrics: { type: mongoose.Schema.Types.Mixed, default: undefined },
    avgVideoMetrics: { type: mongoose.Schema.Types.Mixed, default: undefined },
    modalitiesUsed:  { type: [String], default: undefined }
  },
  // CV Data
  cvData: {
    fileName: String,
    uploadDate: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for faster queries
interviewSchema.index({ userId: 1, createdAt: -1 });
interviewSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Interview', interviewSchema);
