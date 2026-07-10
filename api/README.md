# AI Mock Interview — REST API layer

This `api/` package adds a FastAPI service **alongside** the existing
Streamlit app (`main.py`) and the AI/ML pipelines under `src/`. It does not
change or replace any model logic — every route imports the existing classes
and calls them directly.

## Layout

```
api/
├── main.py                # FastAPI app, CORS, error handlers, router wiring
├── routes/                # One router per endpoint group
│   ├── health.py          # GET  /health, GET /
│   ├── cv.py              # POST /analyze-cv
│   ├── questions.py       # POST /generate-questions
│   ├── evaluation.py      # POST /evaluate-answer
│   ├── interview.py       # POST /complete-interview
│   └── video.py           # POST /analyze-video
├── schemas/               # Pydantic request/response models
│   ├── common.py          # ApiResponse envelope used by every endpoint
│   ├── cv.py
│   ├── questions.py
│   ├── evaluation.py
│   ├── interview.py
│   └── video.py
└── services/
    └── singletons.py      # Cached instances of the existing AI classes
```

## Response envelope

Every endpoint (success or error) returns:

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { },
  "errors": null
}
```

On failure (validation / HTTP error / unhandled exception):

```json
{
  "success": false,
  "message": "Request validation failed",
  "data": null,
  "errors": [
    { "code": "validation_error", "field": "body.num_questions", "message": "Input should be ..." }
  ]
}
```

## Endpoints

| Method | Path | Wraps (existing code) |
|--------|------|------------------------|
| GET    | `/health`              | `OllamaClient.is_server_running` / `list_models` |
| POST   | `/analyze-cv`          | `CVParser.parse_cv` + `CVAnalyzer.analyze` |
| POST   | `/generate-questions`  | `QuestionGenerator.generate_interview_set` |
| POST   | `/evaluate-answer`     | `AnswerEvaluator.evaluate_answer` |
| POST   | `/complete-interview`  | `AnswerEvaluator.evaluate_multiple_answers` + `ScoringEngine.calculate_final_score` |
| POST   | `/analyze-video`       | `AnswerPipeline.analyze` |

OpenAPI / Swagger UI is auto-generated at `/docs`, ReDoc at `/redoc`.

## Install

The new dependencies were added to the project `requirements.txt`:

```
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
python-multipart>=0.0.9
pydantic>=2.5.0
```

```powershell
cd F:\youssef
venv\Scripts\activate
pip install -r requirements.txt
```

Make sure Ollama is running (separate terminal):

```powershell
ollama serve
ollama pull mistral
```

## Run

```powershell
cd F:\youssef
venv\Scripts\activate
uvicorn api.main:app --reload --port 8000
```

The Streamlit app is unaffected and can run in parallel:

```powershell
streamlit run main.py
```

## Quick examples

```bash
# Health
curl http://localhost:8000/health

# Analyse CV
curl -X POST http://localhost:8000/analyze-cv \
     -F "file=@CV.pdf"

# Generate questions
curl -X POST http://localhost:8000/generate-questions \
     -H "Content-Type: application/json" \
     -d '{"profile": {"current_role":"Software Engineer","skills":["Python","FastAPI"]}, "num_questions": 3}'

# Evaluate single answer
curl -X POST http://localhost:8000/evaluate-answer \
     -H "Content-Type: application/json" \
     -d '{"question":"What is REST?","answer":"REST is...","role":"Software Engineer"}'

# Complete interview (text only)
curl -X POST http://localhost:8000/complete-interview \
     -H "Content-Type: application/json" \
     -d '{"role":"Software Engineer","pairs":[{"question":"...","answer":"..."}]}'

# Multimodal video analysis
curl -X POST http://localhost:8000/analyze-video \
     -F "file=@answer.mp4" \
     -F "face_sample_rate=5" \
     -F "emotion_sample_rate=15" \
     -F "max_frames=600"
```

## Notes

- **CORS** is fully open in `api/main.py`. Restrict `allow_origins` to your
  production domain(s) before shipping.
- **Singletons:** `api/services/singletons.py` caches each AI service
  (Whisper / wav2vec2 / MediaPipe / DeepFace / Ollama client) so heavy models
  are loaded **once per process** rather than on every request.
- **Files** uploaded through the API are saved into the same directories the
  Streamlit app uses (`data/uploads/`, `data/recordings/`).
- **No changes** were made to `main.py`, `config.py`, or anything under
  `src/`. The Streamlit MVP keeps working exactly as before.
