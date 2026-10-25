# AI-Based Automatic Survey Form Generator

This is a Diploma IT Engineering minor project. It creates survey questions automatically from a topic entered by the user.

## How to Open in VS Code

1. Open VS Code.
2. Click `File > Open Folder`.
3. Select this folder:
   `AI-Based-Automatic-Survey-Form-Generator`
4. Open the VS Code terminal.
5. Install backend packages:
   `pip install -r requirements.txt`
6. Start the backend:
   `python app.py`
7. Open this URL in browser:
   `http://127.0.0.1:5000`

Simple frontend-only method:

1. Open `index.html`.
2. Right-click and choose `Open with Live Server`.
3. The app will still work using browser storage if Flask is not running.

## Project Files

- `index.html` - page structure
- `style.css` - design and responsive layout
- `script.js` - survey generation, edit, save, and print logic
- `app.py` - Python Flask backend API
- `requirements.txt` - backend packages

## Features

- Enter survey title and topic
- Select number of questions
- Select question type
- Generate automatic questions
- Edit generated questions
- Delete questions
- Add new question
- Save surveys in browser storage
- Open saved surveys
- Print or save survey as PDF

## Working Process

1. User enters survey title.
2. User enters survey topic.
3. User selects number of questions.
4. User selects question type.
5. JavaScript sends the data to Flask backend.
6. Flask generates questions using predefined AI-style templates.
7. User edits the questions if required.
8. User saves the survey.
9. Backend stores the survey while the server is running.
10. User prints or exports it as PDF.

## Backend API Routes

- `GET /` - opens the main project page
- `POST /api/generate` - generates survey questions
- `GET /api/surveys` - shows saved surveys
- `POST /api/surveys` - saves a survey
- `DELETE /api/surveys` - clears saved surveys

## Viva Explanation

This project uses a rule-based AI approach. The system understands the selected topic and combines it with predefined question templates. According to the selected question type, it creates rating, yes/no, MCQ, and short-answer questions.

For example, if the topic is `college canteen`, the system can generate:

- How satisfied are you with college canteen?
- Would you recommend college canteen to others?
- What improvement would you suggest for college canteen?

## Future Scope

- Connect OpenAI API for advanced question generation
- Add login and registration
- Store surveys in MySQL
- Add response collection
- Generate charts for survey answers
- Add Google Forms integration
