# AI-Based Automatic Survey Form Generator

A responsive form builder that turns a natural-language prompt into an editable form. Flask validates and stores forms and submissions in SQLite. When an OpenAI API key is configured, the backend uses the Responses API with Structured Outputs; otherwise it clearly reports that it used a rule-based fallback.

## Run locally

1. Install Python 3.10 or newer.
2. Open this folder in a terminal.
3. Install dependencies: `pip install -r requirements.txt`
4. Optional: configure OpenAI in the backend environment. PowerShell for the current terminal:
   `$env:OPENAI_API_KEY="your-key"`
   Optional model: `$env:OPENAI_MODEL="gpt-4o-mini"`
5. Start Flask: `python app.py`
6. Open `http://127.0.0.1:5000`.

Keep API keys in environment variables. Do not put them in HTML, JavaScript, or a public GitHub repository. Without a key, the fallback can infer common field types and form categories, but works best when the prompt explicitly lists its fields. It does not have the language understanding of an AI model.

## Publish with GitHub Pages

GitHub Pages serves static files (HTML, CSS, and JavaScript); it does not run this Flask application or its SQLite database. A Pages deployment can show the interface, but prompt generation through Flask, cross-device form persistence, and database response collection require the Flask backend to be hosted on a Python-capable service. Set `OPENAI_API_KEY` as a secret/environment variable on that backend host. Then configure the frontend API base in `form-builder.js` for the hosted backend and configure appropriate CORS origins in `app.py` before publishing. Never put the backend key in the Pages code. Local-browser storage is only a per-browser fallback and is not a shared database.

## Form builder

- Describe the form in the prompt; list requested fields and any choices or required/optional rules.
- Generate, then edit title, description, fields, types, options, required state, and question order.
- Save the form; submit preview responses; view private responses in the browser that owns the form; download a standalone form or response JSON.
- Supported fields: short text, long text, number, email, phone, date, dropdown, radio, checkboxes, yes/no, and file upload.
- The backend validates field definitions and submitted answers. File uploads are limited by extension and size.
- No form-sharing/link control is provided.

## Existing classic survey tools

The previous survey generator remains available in the collapsed **Classic survey tools** section. Its API routes are retained for compatibility.

## Project files

- `index.html` — prompt, editor, preview, saved forms, and existing classic tools
- `style.css` — responsive layout and visual styles
- `form-builder.js` — dynamic form generation workflow and UI
- `script.js` — legacy survey generation and storage UI
- `app.py` — Flask routes, validation, optional AI integration, and SQLite persistence
- `requirements.txt` — Python dependencies

## API routes

- `POST /api/forms/generate` — interpret a prompt and return a validated form definition
- `GET /api/forms` — list saved forms
- `POST /api/forms` — create or update a form
- `GET /api/forms/<id>` — retrieve a saved form
- `DELETE /api/forms/<id>` — delete a form (owner token required)
- `GET /api/forms/<id>/responses` — read private responses (owner token required)
- `POST /api/forms/<id>/responses` — validate and save a response
- Legacy routes: `/api/generate` and `/api/surveys`

## Database

The application creates/updates `surveys`, `dynamic_forms`, and `form_responses` tables in `surveys.db` beside `app.py` on startup. Responses link to their form through a foreign key. Uploaded file contents are stored under `uploads/`; response records keep the safe original filename and generated stored filename.
