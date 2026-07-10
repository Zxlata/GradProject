"""Audio processing module (Whisper + wav2vec2 emotion + librosa metrics)."""

from src.audio_processing.audio_emotion_model import Wav2Vec2EmotionModel
from src.audio_processing.emotion_detector import EmotionDetector
from src.audio_processing.speech_to_text import SpeechToText

__all__ = ["EmotionDetector", "SpeechToText", "Wav2Vec2EmotionModel"]
