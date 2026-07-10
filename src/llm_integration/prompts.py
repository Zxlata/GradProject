"""
Prompt templates used across the system.

Every template returns a plain string ready to feed to `OllamaClient.generate`.
JSON-returning prompts explicitly instruct the model to output *only* JSON so
`JSONParser.extract_json` has the best chance of success.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple

# Truncate very long CV text so we don't blow the context window on small models.
_MAX_CV_CHARS = 6000
# Job descriptions can be long; keep them bounded too.
_MAX_JD_CHARS = 2500


def _truncate(text: str, limit: int = _MAX_CV_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n[...truncated...]"


# --------------------------------------------------------------------------- #
# Personalization vocabulary (role / interview-type / difficulty awareness)
# --------------------------------------------------------------------------- #

# Matched by substring against the (lower-cased) target role, longest key first.
_ROLE_FOCUS: Dict[str, str] = {
    "backend": (
        "API design, databases & data modeling, authentication/authorization, "
        "caching, system design, scalability, and reliability"
    ),
    "frontend": (
        "component architecture (e.g. React), state management, rendering "
        "performance, accessibility (a11y), and responsive UI"
    ),
    "full stack": (
        "end-to-end feature delivery, API + UI integration, data modeling, "
        "authentication, and deployment"
    ),
    "ai engineer": (
        "machine learning, deep learning, model deployment/serving, LLMs, "
        "RAG/prompt pipelines, and model evaluation"
    ),
    "machine learning": (
        "ML modeling, feature engineering, training/evaluation, MLOps, and "
        "model deployment"
    ),
    "data scientist": (
        "data analysis, statistics, feature engineering, model selection, and "
        "experiment design"
    ),
    "data engineer": (
        "data pipelines, ETL/ELT, warehousing, streaming, and data quality"
    ),
    "devops": (
        "CI/CD, containers & orchestration, infrastructure-as-code, monitoring, "
        "and reliability"
    ),
    "mobile": (
        "mobile UI, app lifecycle, performance, offline support, and store delivery"
    ),
    "qa": "test strategy, automation, edge cases, and regression coverage",
    "security": (
        "threat modeling, secure coding, auth, and vulnerability mitigation"
    ),
}

_DIFFICULTY_GUIDANCE: Dict[str, str] = {
    "easy": (
        "Target a JUNIOR candidate: fundamentals, day-to-day tasks, and basic "
        "reasoning. Keep the scope small and concrete."
    ),
    "medium": (
        "Target a MID-LEVEL candidate: practical problem-solving, design "
        "choices on a single component, and real trade-offs."
    ),
    "hard": (
        "Target a SENIOR candidate: system design, performance optimization, "
        "deep trade-offs, edge cases, and technical leadership."
    ),
}

_ARABIC_ALIASES = {"ar", "arabic", "ara", "عربي", "العربية", "arab"}


def _role_focus(role: Optional[str]) -> Optional[str]:
    """Return the focus-area string for a role, matching the longest key."""
    if not role:
        return None
    low = role.lower()
    for key in sorted(_ROLE_FOCUS, key=len, reverse=True):
        if key in low:
            return _ROLE_FOCUS[key]
    return None


def _language_clause(language: Optional[str]) -> Tuple[str, str]:
    """Return ``(instruction, display_name)`` for the target language."""
    lang = (language or "english").strip().lower()
    if lang in _ARABIC_ALIASES:
        return (
            "Write the ENTIRE question in clear Modern Standard Arabic. You may "
            "keep well-known technical terms (e.g. API, React, Docker) in "
            "English where that is the natural usage.",
            "Arabic",
        )
    return ("Write the question in clear, professional English.", "English")


def _format_project(project: Any, include_tech: bool = True) -> str:
    if isinstance(project, dict):
        name = project.get("name") or project.get("title") or ""
        desc = project.get("description") or project.get("summary") or ""
        tech = project.get("technologies") or project.get("tech") or ""
        if isinstance(tech, (list, tuple)):
            tech = ", ".join(str(t) for t in tech)
        fields = (name, desc, tech) if include_tech else (name, desc)
        parts = [str(p).strip() for p in fields if str(p).strip()]
        return " — ".join(parts)
    return str(project).strip()


def _format_education(entry: Any) -> str:
    if isinstance(entry, dict):
        bits = [
            str(entry.get(k)).strip()
            for k in ("degree", "field", "institution")
            if entry.get(k)
        ]
        return " in ".join(bits[:2]) + (f" @ {bits[2]}" if len(bits) > 2 else "")
    return str(entry).strip()


def _format_cv_context(cv_data: Dict[str, Any], mode: str = "technical") -> str:
    """Render the candidate profile as a compact, prompt-friendly block.

    ``mode`` controls how much technical detail is surfaced so the CV cannot
    drag a non-technical interview toward implementation questions:

    - ``technical``  full detail (skills + projects with their tech stack)
    - ``behavioral`` projects (as situations, no tech stack) + light skills
    - ``hr``         soft background only (no skills, no projects)
    """
    lines: List[str] = []

    role = cv_data.get("current_role")
    if role:
        lines.append(f"- Current / most recent role: {role}")

    years = cv_data.get("experience_years")
    if years not in (None, ""):
        lines.append(f"- Years of experience: {years}")

    skills = cv_data.get("skills") or []
    if skills and mode == "technical":
        lines.append(f"- Skills: {', '.join(str(s) for s in skills[:15])}")
    elif skills and mode == "behavioral":
        lines.append(
            "- Background areas (context only, do NOT quiz on them): "
            f"{', '.join(str(s) for s in skills[:8])}"
        )

    projects = cv_data.get("projects") or []
    if projects and mode in ("technical", "behavioral"):
        include_tech = mode == "technical"
        formatted = [
            p for p in (_format_project(x, include_tech) for x in projects[:5]) if p
        ]
        if formatted:
            label = "Projects" if include_tech else "Projects / experiences"
            lines.append(f"- {label}: " + " | ".join(formatted))

    education = cv_data.get("education") or []
    if education:
        formatted = [e for e in (_format_education(x) for x in education[:3]) if e]
        if formatted:
            lines.append("- Education: " + "; ".join(formatted))

    summary = cv_data.get("summary") or cv_data.get("about")
    if summary:
        lines.append(f"- Summary: {str(summary).strip()}")

    if not lines:
        return (
            "- No structured CV details available; infer a sensible profile "
            "from the target role and job description."
        )
    return "\n".join(lines)


def _format_avoid(avoid: Optional[Iterable[str]]) -> str:
    items = [str(a).strip() for a in (avoid or []) if str(a).strip()]
    if not items:
        return ""
    bullet = "\n".join(f"  - {q}" for q in items[:12])
    return (
        "\nDo NOT repeat or paraphrase any of these already-asked questions:\n"
        f"{bullet}\n"
    )


# --------------------------------------------------------------------------- #
# Interview-type enforcement (overrides role / skills / JD)
# --------------------------------------------------------------------------- #

# ``do`` = the single allowed shape of the question; ``never`` = hard bans.
_TYPE_RULES: Dict[str, Dict[str, Any]] = {
    "technical": {
        "do": (
            "Ask ONE technical question about implementation, debugging, "
            "architecture, design choices, or engineering trade-offs, grounded "
            "in the candidate's stack and the job's requirements."
        ),
        "never": [],
    },
    "behavioral": {
        "do": (
            "Ask ONE STAR-style behavioral question about a REAL past situation "
            "(Situation, Task, Action, Result). Center it on teamwork, "
            "collaboration, conflict resolution, ownership, leadership, handling "
            "pressure, or learning from failure."
        ),
        "never": [
            "coding, implementation, or 'how would you build X' questions",
            "system design or architecture questions",
            "questions that ask the candidate to explain how a technology works",
        ],
    },
    "hr": {
        "do": (
            "Ask ONE non-technical HR question focused ONLY on motivation, "
            "communication, teamwork, strengths, weaknesses, conflict "
            "resolution, career goals, or company / culture fit."
        ),
        "never": [
            "technical implementation or coding questions",
            "system design or architecture questions",
            "questions about databases, scalability, performance, APIs, "
            "frameworks, or any specific technology",
            "anything that requires technical knowledge to answer",
        ],
    },
    "mixed": {
        "do": (
            "Ask ONE question that is clearly EITHER technical OR behavioral "
            "(alternate between the two across the interview), never a blurred "
            "mix within a single question."
        ),
        "never": [],
    },
}


def _enforcement_block(question_type: str) -> str:
    """High-priority block making interview type override role/skills/JD."""
    rules = _TYPE_RULES.get(question_type, _TYPE_RULES["technical"])
    never = rules.get("never") or []
    never_lines = "\n".join(f"- NEVER ask {item}." for item in never)
    soft_note = ""
    if question_type in ("behavioral", "hr"):
        soft_note = (
            "\n- The technologies, skills, and tools in the CV/JD are NOT valid "
            "question topics here — treat them only as light background."
        )
    return (
        f"This is a {question_type.upper()} interview. The interview TYPE has "
        "the HIGHEST priority and OVERRIDES the target role, the job "
        "description, and the candidate's technical skills.\n"
        f"- DO: {rules['do']}"
        + (f"\n{never_lines}" if never_lines else "")
        + soft_note
    )


def _difficulty_clause(difficulty: str, question_type: str) -> str:
    """Difficulty guidance, framed for technical vs. non-technical interviews."""
    if question_type in ("behavioral", "hr"):
        return {
            "easy": (
                "JUNIOR level: a simple, everyday situation or a single "
                "straightforward prompt. Keep it light, personal, and easy to "
                "answer; no complex scenarios."
            ),
            "medium": (
                "MID level: a realistic situation that needs some reflection "
                "and a concrete example from the candidate's experience."
            ),
            "hard": (
                "SENIOR level: leadership, ownership, mentoring, handling "
                "complex interpersonal dynamics, or high-stakes / strategic "
                "decisions."
            ),
        }.get(difficulty, _DIFFICULTY_GUIDANCE["medium"])
    return _DIFFICULTY_GUIDANCE.get(difficulty, _DIFFICULTY_GUIDANCE["medium"])


class PromptTemplates:
    """Prompt builders for CV analysis, question generation, and evaluation."""

    # ------------------------------------------------------------------ #
    # CV analysis
    # ------------------------------------------------------------------ #

    @staticmethod
    def extract_cv_data(cv_text: str) -> str:
        cv_text = _truncate(cv_text)
        return f"""You are an expert resume parser.

Analyze the CV text below and return a SINGLE JSON object with this exact schema:

{{
  "name": "full name or null",
  "email": "email or null",
  "phone": "phone or null",
  "current_role": "most recent job title or null",
  "experience_years": number_or_null,
  "skills": ["skill1", "skill2"],
  "education": [{{"degree": "...", "field": "...", "institution": "..."}}],
  "languages": ["English"]
}}

Rules:
- Use null for unknown fields, never guess.
- `skills` must be an array of strings; limit to the 15 most relevant.
- Return ONLY the JSON object. No prose, no markdown, no code fences.

CV TEXT:
\"\"\"
{cv_text}
\"\"\"
""".strip()

    # ------------------------------------------------------------------ #
    # Question generation
    # ------------------------------------------------------------------ #

    @staticmethod
    def generate_question(
        cv_data: Dict[str, Any],
        difficulty: str = "medium",
        question_type: str = "technical",
        *,
        role: Optional[str] = None,
        job_description: Optional[str] = None,
        language: str = "english",
        avoid: Optional[Iterable[str]] = None,
        focus: Optional[str] = None,
    ) -> str:
        """Build a strongly personalized question-generation prompt.

        The prompt is shaped by six signals so generated questions clearly
        differ between candidates and configurations:

        - ``cv_data``        candidate skills / projects / experience / education
        - ``job_description``the role's required skills, tech, responsibilities
        - ``role``           the explicit target role (``None`` => auto-detect)
        - ``question_type``  ``technical`` | ``behavioral`` | ``hr`` | ``mixed``
        - ``difficulty``     ``easy`` | ``medium`` | ``hard``
        - ``language``       ``english`` | ``arabic``

        ``avoid`` is a list of already-asked questions used to keep an
        interview set diverse (no repeats / near-duplicates).
        """
        is_technical = question_type == "technical"
        cv_mode = question_type if question_type in ("behavioral", "hr") else "technical"

        cv_context = _format_cv_context(cv_data, mode=cv_mode)
        enforcement_block = _enforcement_block(question_type)
        difficulty_guidance = _difficulty_clause(difficulty, question_type)
        lang_instruction, lang_name = _language_clause(language)
        avoid_block = _format_avoid(avoid)
        focus_block = (
            f"\n=== FOCUS FOR THIS QUESTION ===\nCenter this question on: "
            f"{focus.strip()}. Pick a clearly different angle/topic from any "
            f"already-asked question above.\n"
            if focus and focus.strip()
            else ""
        )

        # ---- Role section ------------------------------------------------- #
        # Technical interviews use the role's focus areas; non-technical
        # interviews treat the role as context only (so it can't steer the
        # question toward architecture / skills).
        if role and is_technical:
            focus_areas = _role_focus(role) or "the core skills this role demands"
            role_block = (
                f"Target role: {role}.\n"
                f"Typical focus areas for this role: {focus_areas}."
            )
        elif role:
            role_block = (
                f"The candidate is interviewing for the {role} role. Use this "
                "only to gauge seniority and context — NOT as a source of "
                "technical question topics."
            )
        elif is_technical:
            role_block = (
                "Target role: AUTO-DETECT. Infer the most likely role from the "
                "candidate's CV and the job description below, then ask a "
                "question appropriate to that role."
            )
        else:
            role_block = (
                "Target role: AUTO-DETECT for seniority/context only — do not "
                "turn it into a technical topic."
            )

        # ---- Job description section -------------------------------------- #
        jd = (job_description or "").strip()
        if jd and is_technical:
            jd_block = (
                "Job description (this MUST heavily drive the question — target "
                "its required skills, technologies, responsibilities, and "
                "seniority):\n"
                f'"""\n{_truncate(jd, _MAX_JD_CHARS)}\n"""'
            )
        elif jd:
            jd_block = (
                "Job description (use ONLY to understand seniority, "
                "responsibilities, and team context — do NOT ask about any "
                "technology, tool, or skill mentioned in it):\n"
                f'"""\n{_truncate(jd, _MAX_JD_CHARS)}\n"""'
            )
        else:
            jd_block = (
                "Job description: not provided. Rely on the target role and the "
                "candidate's CV within the interview-type rules above."
            )

        # ---- Quality rules (type-aware anchoring) ------------------------- #
        if is_technical:
            quality_rules = (
                "- Be specific. Prefer scenario-based or project-based questions "
                "over textbook definitions.\n"
                "- Anchor the question in a concrete skill, technology, project, "
                "or responsibility from the CV or job description.\n"
                '- Avoid vague, generic questions. Bad: "What is React?". Good: '
                '"You built a large React app — how would you diagnose and fix '
                'slow re-renders on its main dashboard?".'
            )
        elif question_type == "behavioral":
            quality_rules = (
                "- Ask about a REAL situation from the candidate's past work or "
                "projects; make it concrete and scenario-based.\n"
                "- Expect a STAR answer (Situation, Task, Action, Result).\n"
                "- Do NOT ask the candidate to design, build, or explain any "
                "technology."
            )
        else:  # hr
            quality_rules = (
                "- Keep it conversational, personal, and strictly non-technical.\n"
                "- Make it specific to a real HR theme (motivation, a strength, "
                "a weakness, teamwork, a conflict, or a career goal).\n"
                '- Bad: "How would you scale MongoDB?". Good: "What motivates '
                'you most about this role, and where do you want to grow next?".'
            )

        return f"""You are an expert interviewer running a {lang_name}, \
{difficulty}-level, {question_type} interview.

Generate EXACTLY ONE {difficulty} {question_type} interview question.

=== STRICT INTERVIEW-TYPE ENFORCEMENT (READ FIRST, HIGHEST PRIORITY) ===
{enforcement_block}

=== TARGET ROLE ===
{role_block}

=== JOB DESCRIPTION ===
{jd_block}

=== CANDIDATE CV ===
{cv_context}

=== DIFFICULTY ({difficulty}) ===
{difficulty_guidance}
The question must clearly read as a {difficulty}-level question.
{focus_block}
=== QUALITY RULES ===
{quality_rules}
{avoid_block}
=== LANGUAGE ===
{lang_instruction}

=== OUTPUT FORMAT ===
- Output ONLY the question text — one question, 1-3 sentences.
- Obey the interview-type rules above even if the CV/JD suggest otherwise.
- No numbering, no preamble, no quotation marks, no explanations.
""".strip()

    # ------------------------------------------------------------------ #
    # Answer evaluation
    # ------------------------------------------------------------------ #

    @staticmethod
    def evaluate_answer(question: str, answer: str, role: str = "Software Engineer") -> str:
        return f"""You are a senior interviewer evaluating a candidate for a {role} position.

QUESTION:
{question}

CANDIDATE ANSWER:
{answer}

Score the answer and return a SINGLE JSON object with this exact schema:

{{
  "correctness_score": 0-100,
  "clarity_score": 0-100,
  "completeness_score": 0-100,
  "strengths": ["short bullet", "short bullet"],
  "areas_to_improve": ["short bullet", "short bullet"],
  "detailed_feedback": "2-3 actionable sentences"
}}

Rules:
- Scores are integers in [0, 100].
- Be fair but strict; a very short or off-topic answer should score low.
- Return ONLY the JSON object. No prose, no markdown, no code fences.
""".strip()

    @staticmethod
    def relevance_qa_batch(pairs: "list[tuple[int, str, str]]") -> str:
        """Pair list: ``(id, question, answer)``; ids are 1-based batch ids."""
        if not pairs:
            return "Return ONLY: {\"results\": []}"

        body_blocks: list[str] = []
        for qid, question, answer in pairs:
            q = (question or "").strip()
            a = (answer or "").strip()
            body_blocks.append(
                f"\n[{qid}]\nQUESTION: {q}\nANSWER: {a}\n"
            )

        tasks = "".join(body_blocks)
        return f"""You are a semantic similarity evaluation system.

Your task is to evaluate how relevant each ANSWER is to its corresponding QUESTION.

You must ignore:
- grammar and spelling
- tone or emotions (anger, sarcasm, politeness)
- length of the answer
- writing style

You must focus ONLY on semantic meaning:
- Does the answer address the question?
- Is it on-topic?
- Does it provide relevant information?

SCORING SCALE (0.0 to 1.0):

0.0 - 0.2 -> completely unrelated or refusal
0.2 - 0.4 -> mostly unrelated, weak topic connection
0.4 - 0.6 -> partially relevant but incomplete or indirect
0.6 - 0.8 -> mostly relevant and answers the question
0.8 - 1.0 -> fully relevant and directly answers the question

IMPORTANT RULES:
- If the answer is a refusal (e.g., "I won't answer", "how dare you"), similarity MUST be 0.2 or lower
- Do NOT reward long answers unless they are relevant
- Do NOT infer correctness, only relevance
- Be strict: irrelevant answers must get low scores

You must return ONLY valid JSON in this exact format (no markdown, no code fences, no other text):
{{"results": [{{"id": 1, "similarity": 0.0, "explanation": "short string"}}, ...]}}

Return one object per task below, in the same order, with matching ids.
EVALUATION TASKS:
{tasks}
""".rstrip()

    # ------------------------------------------------------------------ #
    # General chat (interview coach)
    # ------------------------------------------------------------------ #

    @staticmethod
    def general_chat(user_message: str) -> str:
        return f"""You are a concise, helpful interview coach.

User: {user_message}

Respond in 1-3 sentences with practical advice.
""".strip()
