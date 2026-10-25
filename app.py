"""Flask API and SQLite persistence for the survey generator."""

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("SURVEY_DATABASE", BASE_DIR / "surveys.db"))

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
CORS(app)

QUESTION_TEMPLATES = {
    "rating": [
        "How satisfied are you with {topic}?",
        "How would you rate the quality of {topic}?",
        "How would you rate the service related to {topic}?",
        "How useful do you find {topic}?",
        "How would you rate your overall experience with {topic}?",
    ],
    "yes-no": [
        "Do you think {topic} meets your expectations?",
        "Would you recommend {topic} to others?",
        "Do you face any problem with {topic}?",
        "Is {topic} easy to use or access?",
        "Are you satisfied with {topic}?",
    ],
    "mcq": [
        "Which feature of {topic} do you like the most?",
        "What is your main reason for using {topic}?",
        "Which area of {topic} needs improvement?",
        "How often do you use {topic}?",
        "Which option best describes your experience with {topic}?",
    ],
    "short": [
        "What improvement would you suggest for {topic}?",
        "What problem do you face while using {topic}?",
        "What do you like most about {topic}?",
        "Write your feedback about {topic}.",
        "What changes should be made in {topic}?",
    ],
}
QUESTION_TYPES = {"mixed", *QUESTION_TEMPLATES}


def get_db():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
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


def build_question(topic, question_type, index):
    templates = QUESTION_TEMPLATES[question_type]
    question = {
        "text": templates[index % len(templates)].format(topic=topic),
        "type": question_type,
        "options": [],
    }
    if question_type == "mcq":
        question["options"] = ["Excellent", "Good", "Average", "Poor"]
    elif question_type == "rating":
        question["options"] = ["1", "2", "3", "4", "5"]
    elif question_type == "yes-no":
        question["options"] = ["Yes", "No"]
    return question


def generate_questions(topic, count, selected_type):
    types = ["rating", "yes-no", "mcq", "short"]
    return [
        build_question(topic, types[i % len(types)] if selected_type == "mixed" else selected_type, i)
        for i in range(count)
    ]


def format_survey(row):
    survey = json.loads(row["survey_json"])
    survey["id"] = row["id"]
    survey["title"] = row["title"]
    survey["topic"] = row["topic"]
    survey["createdAt"] = row["created_at"]
    return survey


@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


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

    now = datetime.now().astimezone().strftime("%d-%m-%Y %I:%M %p")
    return jsonify({
        "id": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
        "title": title,
        "topic": topic,
        "createdAt": now,
        "questions": generate_questions(topic, count, question_type),
    })


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
            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, topic=excluded.topic, "
            "created_at=excluded.created_at, survey_json=excluded.survey_json",
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


init_db()

if __name__ == "__main__":
    app.run(debug=True)
