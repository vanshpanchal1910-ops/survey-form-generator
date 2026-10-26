"""Flask API for prompt-generated forms, survey compatibility, and SQLite storage."""

import hashlib
import json
import os
import re
import secrets
import sqlite3
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("SURVEY_DATABASE", BASE_DIR / "surveys.db"))
UPLOAD_DIR = Path(os.environ.get("SURVEY_UPLOADS", BASE_DIR / "uploads"))
MAX_PROMPT_LENGTH = 4000
MAX_FORM_FIELDS = 40
MAX_UPLOAD_SIZE = 8 * 1024 * 1024
ALLOWED_UPLOAD_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "doc", "docx", "txt", "csv"}

FIELD_TYPES = {
    "short_text", "long_text", "number", "email", "phone", "date",
    "dropdown", "radio", "checkboxes", "yes_no", "file",
}
CHOICE_TYPES = {"dropdown", "radio", "checkboxes", "yes_no"}
FIELD_TYPE_LABELS = {
    "short_text": "Short text", "long_text": "Long text", "number": "Number",
    "email": "Email", "phone": "Phone number", "date": "Date",
    "dropdown": "Dropdown", "radio": "Radio buttons", "checkboxes": "Checkboxes",
    "yes_no": "Yes / No", "file": "File upload",
}

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_SIZE
CORS(app)

FORM_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "type": {"type": "string", "enum": sorted(FIELD_TYPES)},
                    "required": {"type": "boolean"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "placeholder": {"type": "string"},
                },
                "required": ["label", "type", "required", "options", "placeholder"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "description", "questions"],
    "additionalProperties": False,
}


def get_db():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS surveys (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                topic TEXT NOT NULL,
                created_at TEXT NOT NULL,
                survey_json TEXT NOT NULL
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS dynamic_forms (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                form_json TEXT NOT NULL,
                prompt TEXT NOT NULL DEFAULT '',
                generation_mode TEXT NOT NULL DEFAULT 'fallback',
                owner_token_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS form_responses (
                id TEXT PRIMARY KEY,
                form_id TEXT NOT NULL REFERENCES dynamic_forms(id) ON DELETE CASCADE,
                response_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_options(value):
    if not isinstance(value, list):
        return []
    options = []
    seen = set()
    for raw_option in value[:30]:
        if not isinstance(raw_option, str):
            continue
        option = raw_option.strip()[:100]
        if option and option.casefold() not in seen:
            options.append(option)
            seen.add(option.casefold())
    return options


def normalize_form_definition(raw_form):
    if not isinstance(raw_form, dict):
        raise ValueError("The generated form must be an object.")
    title = str(raw_form.get("title", "")).strip()[:120]
    description = str(raw_form.get("description", "")).strip()[:500]
    raw_questions = raw_form.get("questions")
    if not title:
        raise ValueError("A form title is required.")
    if not isinstance(raw_questions, list) or not 1 <= len(raw_questions) <= MAX_FORM_FIELDS:
        raise ValueError(f"A form must contain between 1 and {MAX_FORM_FIELDS} fields.")

    questions = []
    seen_labels = set()
    seen_ids = set()
    for raw_question in raw_questions:
        if not isinstance(raw_question, dict):
            continue
        label = str(raw_question.get("label", "")).strip()[:160]
        field_type = raw_question.get("type")
        if not label or not isinstance(field_type, str) or field_type not in FIELD_TYPES:
            continue
        normalized_label = re.sub(r"\s+", " ", label).casefold()
        if normalized_label in seen_labels:
            continue
        seen_labels.add(normalized_label)
        options = clean_options(raw_question.get("options"))
        if field_type == "yes_no":
            options = ["Yes", "No"]
        elif field_type not in CHOICE_TYPES:
            options = []
        elif field_type in CHOICE_TYPES and not options:
            options = default_options(label, raw_form.get("prompt", ""), field_type)
        if field_type in CHOICE_TYPES and not options:
            raise ValueError(f"Add at least one option for {label}.")
        question_id = str(raw_question.get("id") or uuid.uuid4().hex)
        if question_id in seen_ids:
            question_id = uuid.uuid4().hex
        seen_ids.add(question_id)
        required_value = raw_question.get("required", True)
        questions.append({
            "id": question_id,
            "label": label,
            "type": field_type,
            "required": required_value if isinstance(required_value, bool) else True,
            "options": options,
            "placeholder": str(raw_question.get("placeholder", "")).strip()[:160],
        })

    if not questions:
        raise ValueError("List at least one form field in your prompt.")
    return {
        "id": str(raw_form.get("id") or uuid.uuid4().hex),
        "title": title,
        "description": description,
        "questions": questions,
        "prompt": str(raw_form.get("prompt", "")).strip()[:MAX_PROMPT_LENGTH],
        "generationMode": str(raw_form.get("generationMode", "fallback")),
        "createdAt": str(raw_form.get("createdAt") or utc_now()),
        "updatedAt": str(raw_form.get("updatedAt") or utc_now()),
    }


def default_options(label, prompt="", field_type="dropdown"):
    label_lower = label.casefold()
    prompt_lower = prompt.casefold()
    if field_type == "yes_no":
        return ["Yes", "No"]
    if "semester" in label_lower or "term" in label_lower:
        return [f"Semester {number}" for number in range(1, 9)]
    if "division" in label_lower or "section" in label_lower:
        return ["A", "B", "C", "D", "Other"]
    if "branch" in label_lower and ("engineer" in prompt_lower or "student" in prompt_lower):
        return ["Computer Engineering", "Information Technology", "Mechanical Engineering", "Civil Engineering", "Electrical Engineering", "Other"]
    if "gender" in label_lower:
        return ["Female", "Male", "Non-binary", "Prefer not to say"]
    if "rating" in label_lower or "satisfaction" in label_lower:
        return ["1", "2", "3", "4", "5"]
    return []


def title_from_prompt(prompt):
    title_match = re.search(r"\b(?:form\s+title|title)\s*:\s*([^\n.;]{2,120})", prompt, re.I)
    if title_match:
        return title_match.group(1).strip()
    title_match = re.search(
        r"\b(?:create|make|build|generate|design)\s+(?:me\s+)?(?:a|an)\s+(.{2,120}?\bform)\b",
        prompt,
        re.I,
    )
    if title_match:
        return re.sub(r"\s+", " ", title_match.group(1)).strip()
    category_match = re.search(r"\b(student|feedback|registration|admission|event|survey|contact)\s+form\b", prompt, re.I)
    return f"{category_match.group(1).title()} Form" if category_match else "Custom Form"


def find_field_list(prompt):
    patterns = [
        r"\b(?:questions?|fields?|details|information)\s+(?:for|to collect|including|such as|like)\s+(.+)",
        r"\b(?:include|including|collect|collects|capture|ask for)\s+(.+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, prompt, re.I | re.S)
        if match:
            return match.group(1).strip()
    return ""


def parse_field_item(item, prompt):
    item = re.sub(r"^\s*(?:and|or)\s+", "", item.strip(), flags=re.I)
    item = re.sub(r"^\s*(?:\d+[.)]|[-*•])\s*", "", item)
    if not item:
        return None
    optional = bool(re.search(r"\b(optional|not required)\b", item, re.I))
    explicitly_required = bool(re.search(r"\brequired\b", item, re.I))
    options = []
    options_match = re.search(r"\((?:options?|choices?)\s*[:=]\s*([^)]*)\)", item, re.I)
    if options_match:
        options = [part.strip() for part in re.split(r"[,|/]", options_match.group(1)) if part.strip()]
        item = item.replace(options_match.group(0), " ")
    hint = ""
    hint_match = re.search(
        r"\s*(?:\(|\s[-–—:]\s)(short\s*text|long\s*text|text|paragraph|number|email|e-?mail|phone|tel|date|dropdown|select|radio(?:\s+buttons?)?|checkboxes|file\s*upload|yes\s*[/ -]?\s*no)(?:\))?\s*$",
        item,
        re.I,
    )
    if hint_match:
        hint = hint_match.group(1).casefold()
        item = item[:hint_match.start()].strip()
    item = re.sub(r"\s*\((?:optional|required)\)\s*$", "", item, flags=re.I)
    label = item.strip(" \t.,;:-–—")
    if len(label) < 2:
        return None
    field_type = infer_field_type(label, prompt, hint)
    if field_type in CHOICE_TYPES and not options:
        options = default_options(label, prompt, field_type)
    optional_default = field_type == "long_text" and bool(re.search(r"comment|suggest|additional|other feedback", label, re.I))
    return {
        "label": label,
        "type": field_type,
        "required": explicitly_required or (not optional and not optional_default),
        "options": options,
        "placeholder": "",
    }


def infer_field_type(label, prompt="", hint=""):
    hint = hint.casefold()
    hint_map = {
        "short text": "short_text", "shorttext": "short_text", "text": "short_text",
        "long text": "long_text", "paragraph": "long_text", "number": "number",
        "email": "email", "e-mail": "email", "phone": "phone", "tel": "phone",
        "date": "date", "dropdown": "dropdown", "select": "dropdown", "radio": "radio",
        "radio buttons": "radio", "checkboxes": "checkboxes", "file upload": "file",
        "yes/no": "yes_no", "yes - no": "yes_no", "yes no": "yes_no",
    }
    if hint in hint_map:
        return hint_map[hint]

    normalized = label.casefold()
    prompt_lower = prompt.casefold()
    if re.search(r"email|e-mail", normalized):
        return "email"
    if re.search(r"mobile|phone|telephone|contact number", normalized):
        return "phone"
    if re.search(r"date|birth|\bdob\b", normalized):
        return "date"
    if re.search(r"upload|attach|file|document|photo|image", normalized):
        return "file"
    if re.search(r"comment|feedback|suggestion|description|message|reason|address", normalized):
        return "long_text"
    if re.search(r"\b(age|quantity|count|amount|marks|score|rating)\b", normalized):
        return "number"
    if re.search(r"\b(semester|term|division|section|branch|department|course|program|gender|category)\b", normalized):
        if "gender" in normalized:
            return "dropdown"
        return "dropdown"
    if re.search(r"select all|choose all|multiple choice|checkbox", prompt_lower) and re.search(r"interest|skill|preference|activity|service", normalized):
        return "checkboxes"
    if "radio button" in prompt_lower and re.search(r"choice|option|rating|satisfaction", normalized):
        return "radio"
    if re.search(r"\b(yes/no|agree|consent|permission)\b", normalized):
        return "yes_no"
    return "short_text"


def fallback_fields(prompt, title):
    explicit_list = find_field_list(prompt)
    if explicit_list:
        parts = re.split(r"\s*(?:,|;|\n|\band\b|\bor\b)\s*", explicit_list, flags=re.I)
        fields = [field for field in (parse_field_item(part, prompt) for part in parts) if field]
        if fields:
            return fields

    normalized = f"{title} {prompt}".casefold()
    if "student" in normalized or "enrollment" in normalized or "semester" in normalized:
        labels = [
            ("Student Name", "short_text", []),
            ("Enrollment Number", "short_text", []),
            ("Division", "dropdown", ["A", "B", "C", "D", "Other"]),
            ("Branch", "dropdown", default_options("Branch", prompt, "dropdown")),
            ("Semester", "dropdown", default_options("Semester", prompt, "dropdown")),
            ("Email Address", "email", []),
            ("Mobile Number", "phone", []),
            ("Date of Birth", "date", []),
        ]
        return [
            {"label": label, "type": field_type, "required": True, "options": options, "placeholder": ""}
            for label, field_type, options in labels
        ]
    if "feedback" in normalized or "review" in normalized:
        return [
            {"label": "Overall experience", "type": "radio", "required": True, "options": ["Excellent", "Good", "Average", "Poor"], "placeholder": ""},
            {"label": "What would you like us to improve?", "type": "long_text", "required": False, "options": [], "placeholder": "Share any suggestions"},
        ]
    if "admission" in normalized:
        return [
            {"label": "Student Name", "type": "short_text", "required": True, "options": [], "placeholder": ""},
            {"label": "Date of Birth", "type": "date", "required": True, "options": [], "placeholder": ""},
            {"label": "Email Address", "type": "email", "required": True, "options": [], "placeholder": ""},
            {"label": "Mobile Number", "type": "phone", "required": True, "options": [], "placeholder": ""},
            {"label": "Program", "type": "dropdown", "required": True, "options": ["Undergraduate", "Postgraduate", "Other"], "placeholder": ""},
        ]
    if "registration" in normalized or "sign up" in normalized:
        fields = [
            {"label": "Full Name", "type": "short_text", "required": True, "options": [], "placeholder": ""},
            {"label": "Email Address", "type": "email", "required": True, "options": [], "placeholder": ""},
        ]
        if "event" in normalized:
            fields.append({"label": "Which session would you like to attend?", "type": "short_text", "required": True, "options": [], "placeholder": ""})
        return fields
    if "event" in normalized:
        return [
            {"label": "Full Name", "type": "short_text", "required": True, "options": [], "placeholder": ""},
            {"label": "Email Address", "type": "email", "required": True, "options": [], "placeholder": ""},
            {"label": "Which session would you like to attend?", "type": "short_text", "required": True, "options": [], "placeholder": ""},
        ]
    raise ValueError("Please describe the form and list the fields you want, or configure OPENAI_API_KEY for AI prompt interpretation.")


def fallback_form_from_prompt(prompt):
    title = title_from_prompt(prompt)
    explicit_description = re.search(r"\bdescription\s*:\s*(.+?)(?=\b(?:fields?|questions?)\s+(?:for|to collect)|$)", prompt, re.I | re.S)
    if explicit_description:
        description = explicit_description.group(1).strip(" .\n")[:500]
    else:
        description = f"Complete this form to provide the requested {title.removesuffix(' Form').lower()} information."
    return {
        "title": title,
        "description": description,
        "questions": fallback_fields(prompt, title),
        "prompt": prompt,
    }


def generate_with_openai(prompt):
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    instructions = (
        "Design an HTML form from the user's request. Extract only fields relevant to the request, preserve their requested order, "
        "avoid duplicates, infer correct field types and required status, and include dropdown options only when specified or strongly conventional. "
        "Do not add unrelated fields. If specific fields are listed, include only those fields. Return the form using the supplied JSON schema."
    )
    payload = {
        "model": model,
        "input": [
            {"role": "developer", "content": instructions},
            {"role": "user", "content": prompt},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "generated_form",
                "strict": True,
                "schema": FORM_JSON_SCHEMA,
            }
        },
    }
    api_request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(api_request, timeout=45) as response:
            api_response = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"OpenAI API request failed ({error.code}): {detail}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError("OpenAI API could not be reached.") from error

    output_parts = []
    for output_item in api_response.get("output", []):
        if output_item.get("type") != "message":
            continue
        for content_item in output_item.get("content", []):
            if content_item.get("type") == "refusal":
                raise RuntimeError("The AI service could not generate a form from that prompt.")
            if content_item.get("type") == "output_text":
                output_parts.append(content_item.get("text", ""))
    if not output_parts:
        raise RuntimeError("The AI service returned no form data.")
    return json.loads("".join(output_parts))


def format_saved_form(row):
    form_data = json.loads(row["form_json"])
    form_data.update({"id": row["id"], "title": row["title"], "description": row["description"], "createdAt": row["created_at"], "updatedAt": row["updated_at"]})
    return form_data


def owner_token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def owner_authorized(row):
    provided = request.headers.get("X-Form-Owner-Token", "")
    return bool(provided) and secrets.compare_digest(owner_token_hash(provided), row["owner_token_hash"])


def validate_response(form_definition, response_values, uploaded_files=None):
    if not isinstance(response_values, dict):
        raise ValueError("Response answers must be an object.")
    uploaded_files = uploaded_files or {}
    questions = form_definition["questions"]
    allowed_keys = {f"q_{question['id']}" for question in questions}
    if any(key not in allowed_keys for key in response_values):
        raise ValueError("Response contains an unknown field.")
    answers = {}
    file_metadata = {}

    for question in questions:
        question_id = question["id"]
        key = f"q_{question_id}"
        value = response_values.get(key)
        file_obj = uploaded_files.get(key)
        if question["type"] == "file":
            if file_obj and file_obj.filename:
                safe_name = secure_filename(file_obj.filename)
                extension = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""
                if extension not in ALLOWED_UPLOAD_EXTENSIONS:
                    raise ValueError(f"File type is not allowed for {question['label']}.")
                stored_name = f"{uuid.uuid4().hex}.{extension}"
                target_dir = UPLOAD_DIR / form_definition["id"]
                target_dir.mkdir(parents=True, exist_ok=True)
                file_obj.save(target_dir / stored_name)
                file_metadata[key] = {"name": safe_name, "storedName": stored_name}
                answers[key] = safe_name
            elif question["required"]:
                raise ValueError(f"{question['label']} is required.")
            else:
                answers[key] = None
            continue

        if isinstance(value, list):
            if question["type"] != "checkboxes" or any(not isinstance(item, (str, int, float, bool)) for item in value):
                raise ValueError(f"Enter a valid answer for {question['label']}.")
            cleaned = [str(item).strip()[:5000] for item in value]
            value = cleaned
        elif value is not None:
            if not isinstance(value, (str, int, float, bool)):
                raise ValueError(f"Enter a valid answer for {question['label']}.")
            value = str(value).strip()[:5000]
        empty_value = value is None or value == "" or value == []
        if question["required"] and empty_value:
            raise ValueError(f"{question['label']} is required.")
        if empty_value:
            answers[key] = value
            continue

        field_type = question["type"]
        if field_type == "email" and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError(f"Enter a valid email address for {question['label']}.")
        if field_type == "phone" and not re.fullmatch(r"[+0-9() .-]{7,24}", value):
            raise ValueError(f"Enter a valid phone number for {question['label']}.")
        if field_type == "number":
            try:
                float(value)
            except (TypeError, ValueError):
                raise ValueError(f"Enter a valid number for {question['label']}.") from None
        if field_type == "date":
            try:
                date.fromisoformat(value)
            except (TypeError, ValueError):
                raise ValueError(f"Enter a valid date for {question['label']}.") from None
        if field_type in {"dropdown", "radio", "yes_no"} and value not in question["options"]:
            raise ValueError(f"Choose a valid option for {question['label']}.")
        if field_type == "checkboxes":
            if not isinstance(value, list) or any(item not in question["options"] for item in value):
                raise ValueError(f"Choose valid options for {question['label']}.")
        answers[key] = value

    return {"answers": answers, "files": file_metadata}


@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/api/forms/generate", methods=["POST"])
def generate_dynamic_form():
    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return jsonify({"error": "Describe the form you want first."}), 400
    prompt = prompt.strip()
    if len(prompt) > MAX_PROMPT_LENGTH:
        return jsonify({"error": f"Keep the prompt under {MAX_PROMPT_LENGTH} characters."}), 400

    generation_mode = "fallback"
    notice = "No OpenAI API key is configured. Used the rule-based prompt parser; list your fields for the most accurate result."
    try:
        definition = generate_with_openai(prompt)
        if definition is not None:
            generation_mode = "openai"
            notice = "Generated with OpenAI and checked against the form schema."
        else:
            definition = fallback_form_from_prompt(prompt)
    except Exception as error:
        try:
            definition = fallback_form_from_prompt(prompt)
            notice = f"AI generation was unavailable ({str(error)[:160]}). Used the rule-based fallback instead."
        except ValueError as fallback_error:
            return jsonify({"error": str(fallback_error)}), 422

    try:
        form_data = normalize_form_definition({**definition, "prompt": prompt, "generationMode": generation_mode})
    except ValueError as error:
        return jsonify({"error": str(error)}), 422
    return jsonify({"form": form_data, "generationMode": generation_mode, "notice": notice})


@app.route("/api/forms", methods=["GET", "POST"])
def forms_collection():
    if request.method == "GET":
        with get_db() as connection:
            rows = connection.execute("""
                SELECT f.id, f.title, f.description, f.updated_at,
                       json_array_length(json_extract(f.form_json, '$.questions')) AS field_count,
                       (SELECT COUNT(*) FROM form_responses r WHERE r.form_id = f.id) AS response_count
                FROM dynamic_forms f ORDER BY f.updated_at DESC
            """).fetchall()
        return jsonify([{
            "id": row["id"], "title": row["title"], "description": row["description"],
            "updatedAt": row["updated_at"], "fieldCount": row["field_count"], "responseCount": row["response_count"],
        } for row in rows])

    data = request.get_json(silent=True) or {}
    raw_form = data.get("form")
    try:
        form_data = normalize_form_definition(raw_form)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    form_data["prompt"] = str((raw_form or {}).get("prompt", ""))[:MAX_PROMPT_LENGTH]
    form_data["generationMode"] = str((raw_form or {}).get("generationMode", "fallback"))
    now = utc_now()
    form_id = form_data["id"]
    owner_token = None
    with get_db() as connection:
        existing = connection.execute("SELECT * FROM dynamic_forms WHERE id = ?", (form_id,)).fetchone()
        if existing:
            if not owner_authorized(existing):
                return jsonify({"error": "You do not have permission to update this form. Reload it in the browser where it was created."}), 403
            created_at = existing["created_at"]
            connection.execute(
                "UPDATE dynamic_forms SET title=?, description=?, form_json=?, prompt=?, generation_mode=?, updated_at=? WHERE id=?",
                (form_data["title"], form_data["description"], json.dumps(form_data), form_data["prompt"], form_data["generationMode"], now, form_id),
            )
        else:
            form_id = uuid.uuid4().hex
            form_data["id"] = form_id
            owner_token = secrets.token_urlsafe(32)
            created_at = now
            form_data["createdAt"] = created_at
            form_data["updatedAt"] = now
            connection.execute(
                "INSERT INTO dynamic_forms (id, title, description, form_json, prompt, generation_mode, owner_token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (form_id, form_data["title"], form_data["description"], json.dumps(form_data), form_data["prompt"], form_data["generationMode"], owner_token_hash(owner_token), created_at, now),
            )
    form_data["createdAt"] = created_at
    form_data["updatedAt"] = now
    return jsonify({"message": "Form saved.", "form": form_data, "ownerToken": owner_token}), 201


@app.route("/api/forms/<form_id>", methods=["GET", "DELETE"])
def form_detail(form_id):
    with get_db() as connection:
        row = connection.execute("SELECT * FROM dynamic_forms WHERE id = ?", (form_id,)).fetchone()
        if row is None:
            return jsonify({"error": "Form not found."}), 404
        if request.method == "GET":
            return jsonify(format_saved_form(row))
        if not owner_authorized(row):
            return jsonify({"error": "You do not have permission to delete this form."}), 403
        connection.execute("DELETE FROM dynamic_forms WHERE id = ?", (form_id,))
    return jsonify({"message": "Form deleted."})


@app.route("/api/forms/<form_id>/responses", methods=["GET", "POST"])
def form_responses(form_id):
    with get_db() as connection:
        form_row = connection.execute("SELECT * FROM dynamic_forms WHERE id = ?", (form_id,)).fetchone()
        if form_row is None:
            return jsonify({"error": "Form not found."}), 404
        if request.method == "GET":
            if not owner_authorized(form_row):
                return jsonify({"error": "The owner token is missing or invalid."}), 403
            rows = connection.execute("SELECT id, response_json, created_at FROM form_responses WHERE form_id = ? ORDER BY created_at DESC", (form_id,)).fetchall()
            return jsonify([{"id": row["id"], "createdAt": row["created_at"], **json.loads(row["response_json"])} for row in rows])

        form_data = format_saved_form(form_row)
        question_keys = {f"q_{question['id']}" for question in form_data["questions"]}
        response_values = {}
        uploaded_files = {}
        if request.mimetype == "application/json":
            payload = request.get_json(silent=True) or {}
            response_values = payload.get("answers", {})
        else:
            for key in question_keys:
                question = next(item for item in form_data["questions"] if f"q_{item['id']}" == key)
                if question["type"] == "checkboxes":
                    response_values[key] = request.form.getlist(key)
                elif question["type"] != "file":
                    response_values[key] = request.form.get(key)
                upload = request.files.get(key)
                if upload:
                    uploaded_files[key] = upload
        try:
            normalized_response = validate_response(form_data, response_values, uploaded_files)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        response_id = uuid.uuid4().hex
        created_at = utc_now()
        connection.execute(
            "INSERT INTO form_responses (id, form_id, response_json, created_at) VALUES (?, ?, ?, ?)",
            (response_id, form_id, json.dumps(normalized_response), created_at),
        )
    return jsonify({"message": "Response saved.", "responseId": response_id, "createdAt": created_at}), 201


# Legacy survey generation and storage routes remain available.
QUESTION_TEMPLATES = {
    "rating": [
        "How satisfied are you with {topic}?", "How would you rate the quality of {topic}?",
        "How would you rate the service related to {topic}?", "How useful do you find {topic}?",
        "How would you rate your overall experience with {topic}?",
    ],
    "yes-no": [
        "Do you think {topic} meets your expectations?", "Would you recommend {topic} to others?",
        "Do you face any problem with {topic}?", "Is {topic} easy to use or access?", "Are you satisfied with {topic}?",
    ],
    "mcq": [
        "Which feature of {topic} do you like the most?", "What is your main reason for using {topic}?",
        "Which area of {topic} needs improvement?", "How often do you use {topic}?",
        "Which option best describes your experience with {topic}?",
    ],
    "short": [
        "What improvement would you suggest for {topic}?", "What problem do you face while using {topic}?",
        "What do you like most about {topic}?", "Write your feedback about {topic}.", "What changes should be made in {topic}?",
    ],
}
QUESTION_TYPES = {"mixed", *QUESTION_TEMPLATES}


def build_question(topic, question_type, index):
    templates = QUESTION_TEMPLATES[question_type]
    question = {"text": templates[index % len(templates)].format(topic=topic), "type": question_type, "options": []}
    if question_type == "mcq":
        question["options"] = ["Excellent", "Good", "Average", "Poor"]
    elif question_type == "rating":
        question["options"] = ["1", "2", "3", "4", "5"]
    elif question_type == "yes-no":
        question["options"] = ["Yes", "No"]
    return question


def generate_questions(topic, count, selected_type):
    types = ["rating", "yes-no", "mcq", "short"]
    return [build_question(topic, types[index % len(types)] if selected_type == "mixed" else selected_type, index) for index in range(count)]


def format_survey(row):
    survey = json.loads(row["survey_json"])
    survey.update({"id": row["id"], "title": row["title"], "topic": row["topic"], "createdAt": row["created_at"]})
    return survey


@app.route("/api/generate", methods=["POST"])
def generate_survey():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title", "")).strip()
    topic = str(data.get("topic", "")).strip()
    question_type = data.get("questionType", "mixed")
    if not title or not topic:
        return jsonify({"error": "Survey title and topic are required."}), 400
    if not isinstance(question_type, str) or question_type not in QUESTION_TYPES:
        return jsonify({"error": "Choose a valid question type."}), 400
    try:
        count = int(data.get("questionCount", 5))
    except (TypeError, ValueError):
        return jsonify({"error": "Question count must be a number."}), 400
    if not 3 <= count <= 15:
        return jsonify({"error": "Question count must be between 3 and 15."}), 400
    return jsonify({"id": str(int(datetime.now(timezone.utc).timestamp() * 1000)), "title": title, "topic": topic,
                    "createdAt": datetime.now().astimezone().strftime("%d-%m-%Y %I:%M %p"),
                    "questions": generate_questions(topic, count, question_type)})


@app.route("/api/surveys", methods=["GET"])
def get_surveys():
    with get_db() as connection:
        rows = connection.execute("SELECT * FROM surveys ORDER BY rowid DESC").fetchall()
    return jsonify([format_survey(row) for row in rows])


@app.route("/api/surveys", methods=["POST"])
def save_survey():
    survey = request.get_json(silent=True) or {}
    title = str(survey.get("title", "")).strip()
    topic = str(survey.get("topic", "")).strip()
    questions = survey.get("questions")
    if not title or not topic or not isinstance(questions, list) or not questions:
        return jsonify({"error": "Valid survey title, topic, and questions are required."}), 400
    survey_id = str(survey.get("id") or int(datetime.now(timezone.utc).timestamp() * 1000))
    created_at = survey.get("createdAt") or datetime.now().astimezone().strftime("%d-%m-%Y %I:%M %p")
    stored_survey = {**survey, "id": survey_id, "title": title, "topic": topic, "createdAt": created_at}
    with get_db() as connection:
        connection.execute(
            "INSERT INTO surveys (id, title, topic, created_at, survey_json) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, topic=excluded.topic, created_at=excluded.created_at, survey_json=excluded.survey_json",
            (survey_id, title, topic, created_at, json.dumps(stored_survey)),
        )
    return jsonify({"message": "Survey saved successfully.", "survey": stored_survey}), 201


@app.route("/api/surveys/<survey_id>", methods=["GET", "DELETE"])
def survey_detail(survey_id):
    with get_db() as connection:
        if request.method == "DELETE":
            cursor = connection.execute("DELETE FROM surveys WHERE id = ?", (survey_id,))
            if cursor.rowcount == 0:
                return jsonify({"error": "Survey not found."}), 404
            return jsonify({"message": "Survey deleted."})
        row = connection.execute("SELECT * FROM surveys WHERE id = ?", (survey_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Survey not found."}), 404
    return jsonify(format_survey(row))


@app.route("/api/surveys", methods=["DELETE"])
def clear_surveys():
    with get_db() as connection:
        connection.execute("DELETE FROM surveys")
    return jsonify({"message": "All saved surveys cleared."})


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "The uploaded file is too large. Maximum size is 8 MB."}), 413


init_db()

if __name__ == "__main__":
    app.run(debug=True)
