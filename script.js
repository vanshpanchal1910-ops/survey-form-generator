const form = document.getElementById("surveyForm");
const preview = document.getElementById("surveyPreview");
const addQuestionBtn = document.getElementById("addQuestionBtn");
const saveSurveyBtn = document.getElementById("saveSurveyBtn");
const downloadSurveyBtn = document.getElementById("downloadSurveyBtn");
const printSurveyBtn = document.getElementById("printSurveyBtn");
const generateSurveyBtn = document.getElementById("generateSurveyBtn");
const toast = document.getElementById("toast");
const savedSurveys = document.getElementById("savedSurveys");
const clearSavedBtn = document.getElementById("clearSavedBtn");

let currentSurvey = null;
let toastTimer;
const API_BASE = "";

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

const questionTemplates = {
  rating: [
    "How satisfied are you with {topic}?",
    "How would you rate the quality of {topic}?",
    "How would you rate the service related to {topic}?",
    "How useful do you find {topic}?",
    "How would you rate your overall experience with {topic}?"
  ],
  "yes-no": [
    "Do you think {topic} meets your expectations?",
    "Would you recommend {topic} to others?",
    "Do you face any problem with {topic}?",
    "Is {topic} easy to use or access?",
    "Are you satisfied with {topic}?"
  ],
  mcq: [
    "Which feature of {topic} do you like the most?",
    "What is your main reason for using {topic}?",
    "Which area of {topic} needs improvement?",
    "How often do you use {topic}?",
    "Which option best describes your experience with {topic}?"
  ],
  short: [
    "What improvement would you suggest for {topic}?",
    "What problem do you face while using {topic}?",
    "What do you like most about {topic}?",
    "Write your feedback about {topic}.",
    "What changes should be made in {topic}?"
  ]
};

const typeLabels = {
  rating: "Rating",
  "yes-no": "Yes/No",
  mcq: "MCQ",
  short: "Short Answer"
};

function buildQuestion(topic, type, index) {
  const templates = questionTemplates[type];
  const text = templates[index % templates.length].replace("{topic}", topic);

  const question = {
    text,
    type,
    options: []
  };

  if (type === "mcq") {
    question.options = ["Excellent", "Good", "Average", "Poor"];
  }

  if (type === "rating") {
    question.options = ["1", "2", "3", "4", "5"];
  }

  if (type === "yes-no") {
    question.options = ["Yes", "No"];
  }

  return question;
}

function generateQuestions(topic, count, selectedType) {
  const types = ["rating", "yes-no", "mcq", "short"];
  const questions = [];

  for (let i = 0; i < count; i++) {
    const type = selectedType === "mixed" ? types[i % types.length] : selectedType;
    questions.push(buildQuestion(topic, type, i));
  }

  return questions;
}

function renderSurvey() {
  if (!currentSurvey) {
    preview.className = "survey-preview empty";
    preview.textContent = "Enter survey details and click Generate Survey.";
    document.querySelector(".actions").hidden = true;
    return;
  }

  document.querySelector(".actions").hidden = false;
  preview.className = "survey-preview";
  preview.innerHTML = `
    <div class="survey-title">
      <h3>${escapeHtml(currentSurvey.title)}</h3>
      <span>Topic: ${escapeHtml(currentSurvey.topic)}</span>
    </div>
  `;

  currentSurvey.questions.forEach((question, index) => {
    const card = document.createElement("div");
    card.className = "question-card";

    const optionsHtml = question.options.length
      ? `<ol class="option-list">${question.options.map(option => `<li>${escapeHtml(option)}</li>`).join("")}</ol>`
      : "";

    card.innerHTML = `
      <div class="question-top">
        <span class="question-number">Question ${index + 1}</span>
        <span class="question-type">${typeLabels[question.type]}</span>
      </div>
      <textarea data-index="${index}" class="question-input">${escapeHtml(question.text)}</textarea>
      ${optionsHtml}
      <div class="question-controls">
        <button type="button" data-edit="${index}">Update</button>
        <button type="button" data-delete="${index}">Delete</button>
      </div>
    `;

    preview.appendChild(card);
  });

}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  const title = document.getElementById("surveyTitle").value.trim();
  const topic = document.getElementById("surveyTopic").value.trim();
  const count = Number(document.getElementById("questionCount").value);
  const selectedType = document.getElementById("questionType").value;
  const submitLabel = generateSurveyBtn.querySelector("span:first-child");
  generateSurveyBtn.disabled = true;
  generateSurveyBtn.classList.add("is-loading");
  submitLabel.textContent = "Creating your survey…";

  try {
    const response = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        topic,
        questionCount: count,
        questionType: selectedType
      })
    });

    if (!response.ok) {
      throw new Error("Backend is not available");
    }

    currentSurvey = await response.json();
  } catch (error) {
    currentSurvey = {
      id: Date.now(),
      title,
      topic,
      createdAt: new Date().toLocaleString(),
      questions: generateQuestions(topic, count, selectedType)
    };
  }

  generateSurveyBtn.disabled = false;
  generateSurveyBtn.classList.remove("is-loading");
  submitLabel.textContent = "Generate my survey";
  renderSurvey();
  showToast("Your survey is ready to review.");
  preview.scrollIntoView({ behavior: "smooth", block: "start" });
});

preview.addEventListener("click", event => {
  if (!currentSurvey) return;

  const editIndex = event.target.dataset.edit;
  const deleteIndex = event.target.dataset.delete;

  if (editIndex !== undefined) {
    const input = preview.querySelector(`textarea[data-index="${editIndex}"]`);
    currentSurvey.questions[editIndex].text = input.value.trim();
    renderSurvey();
    showToast("Question updated.");
  }

  if (deleteIndex !== undefined) {
    currentSurvey.questions.splice(Number(deleteIndex), 1);
    renderSurvey();
    showToast("Question removed.");
  }
});

addQuestionBtn.addEventListener("click", () => {
  if (!currentSurvey) {
    showToast("Generate a survey before adding a question.");
    return;
  }

  currentSurvey.questions.push({
    text: `Write your question about ${currentSurvey.topic}.`,
    type: "short",
    options: []
  });

  renderSurvey();
  showToast("A new question was added.");
});

saveSurveyBtn.addEventListener("click", async () => {
  if (!currentSurvey) {
    showToast("Generate a survey before saving it.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/surveys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(currentSurvey)
    });

    if (!response.ok) {
      throw new Error("Backend save failed");
    }
  } catch (error) {
    const surveys = getLocalSavedSurveys();
    surveys.unshift(currentSurvey);
    localStorage.setItem("aiSurveyGeneratorData", JSON.stringify(surveys));
  }

  renderSavedSurveys();
  showToast("Survey saved successfully.");
});

downloadSurveyBtn.addEventListener("click", () => {
  if (!currentSurvey) {
    showToast("Generate a survey before downloading it.");
    return;
  }

  const questions = currentSurvey.questions.map((question, index) => {
    const fieldName = `question-${index + 1}`;
    const prompt = escapeHtml(question.text);
    let answerField;

    if (question.type === "short") {
      answerField = `<textarea name="${fieldName}" rows="4" required></textarea>`;
    } else {
      const options = question.options || [];
      answerField = `<div class="choices">${options.map((option, optionIndex) => `
        <label class="choice">
          <input type="radio" name="${fieldName}" value="${escapeHtml(option)}" ${optionIndex === 0 ? "required" : ""}>
          <span>${escapeHtml(option)}</span>
        </label>`).join("")}
      </div>`;
    }

    return `<fieldset class="question">
      <legend><span>Question ${index + 1}</span>${prompt}</legend>
      ${answerField}
    </fieldset>`;
  }).join("");

  const surveyDefinition = JSON.stringify({
    title: currentSurvey.title,
    questions: currentSurvey.questions.map(question => ({ text: question.text }))
  }).replaceAll("<", "\\u003c");

  const formHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(currentSurvey.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 36px 18px; color: #17231f; background: #f5f8f4; font: 16px/1.55 Arial, sans-serif; }
    main { max-width: 760px; margin: auto; padding: 30px; background: #fff; border: 1px solid #e1e9e4; border-radius: 18px; box-shadow: 0 18px 48px rgba(24,54,39,.08); }
    h1 { margin: 0 0 4px; font-size: 28px; }
    .topic { margin: 0 0 24px; color: #6c7b75; }
    .question { margin: 0 0 14px; padding: 17px; border: 1px solid #e1e9e4; border-radius: 12px; }
    legend { padding: 0 5px; font-weight: 700; }
    legend span { display: block; margin-bottom: 4px; color: #256d53; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    textarea { width: 100%; margin-top: 12px; padding: 11px; border: 1px solid #dbe5de; border-radius: 9px; font: inherit; resize: vertical; }
    .choices { display: grid; gap: 8px; margin-top: 12px; }
    .choice { display: flex; align-items: center; gap: 9px; padding: 10px 12px; border: 1px solid #e8eee9; border-radius: 8px; }
    .choice input { accent-color: #256d53; }
    button { margin-top: 8px; padding: 12px 18px; color: #fff; background: #256d53; border: 0; border-radius: 9px; font-weight: 700; cursor: pointer; }
    button:hover { background: #1c523e; }
    @media (max-width: 520px) { main { padding: 20px; } body { padding: 18px 12px; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(currentSurvey.title)}</h1>
    <p class="topic">Topic: ${escapeHtml(currentSurvey.topic)}</p>
    <form id="response-form">
      ${questions}
      <button type="submit">Download my answers</button>
    </form>
  </main>
  <script>
    const survey = ${surveyDefinition};
    document.getElementById("response-form").addEventListener("submit", event => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const response = {
        surveyTitle: survey.title,
        submittedAt: new Date().toISOString(),
        answers: survey.questions.map((question, index) => ({
          question: question.text,
          answer: formData.get("question-" + (index + 1))
        }))
      };
      const blob = new Blob([JSON.stringify(response, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "survey-answers.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
  <\/script>
</body>
</html>`;

  const blob = new Blob([formHtml], { type: "text/html;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${currentSurvey.title.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "survey"}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("Fillable survey form downloaded.");
});

printSurveyBtn.addEventListener("click", () => {
  if (!currentSurvey) {
    showToast("Generate a survey before printing it.");
    return;
  }

  window.print();
});

clearSavedBtn.addEventListener("click", async () => {
  try {
    await fetch(`${API_BASE}/api/surveys`, {
      method: "DELETE"
    });
  } catch (error) {
    // Browser storage fallback is cleared below.
  }

  localStorage.removeItem("aiSurveyGeneratorData");
  renderSavedSurveys();
});

function getLocalSavedSurveys() {
  return JSON.parse(localStorage.getItem("aiSurveyGeneratorData")) || [];
}

async function getSavedSurveys() {
  try {
    const response = await fetch(`${API_BASE}/api/surveys`);

    if (!response.ok) {
      throw new Error("Backend list failed");
    }

    return await response.json();
  } catch (error) {
    return getLocalSavedSurveys();
  }
}

async function renderSavedSurveys() {
  const surveys = await getSavedSurveys();

  if (surveys.length === 0) {
    savedSurveys.innerHTML = "<p>No saved surveys yet.</p>";
    return;
  }

  savedSurveys.innerHTML = "";
  surveys.forEach(survey => {
    const item = document.createElement("div");
    item.className = "saved-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(survey.title)}</strong>
        <span>${escapeHtml(survey.topic)} | ${survey.questions.length} questions | ${escapeHtml(survey.createdAt)}</span>
      </div>
      <button type="button" data-load="${survey.id}">Open</button>
    `;
    savedSurveys.appendChild(item);
  });
}

savedSurveys.addEventListener("click", async event => {
  const id = event.target.dataset.load;
  if (!id) return;

  const surveys = await getSavedSurveys();
  currentSurvey = surveys.find(survey => String(survey.id) === String(id));
  renderSurvey();
  if (currentSurvey) showToast("Saved survey loaded.");
});

renderSavedSurveys();
