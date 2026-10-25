const form = document.getElementById("surveyForm");
const preview = document.getElementById("surveyPreview");
const addQuestionBtn = document.getElementById("addQuestionBtn");
const saveSurveyBtn = document.getElementById("saveSurveyBtn");
const printSurveyBtn = document.getElementById("printSurveyBtn");
const savedSurveys = document.getElementById("savedSurveys");
const clearSavedBtn = document.getElementById("clearSavedBtn");

let currentSurvey = null;
const API_BASE = "";

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
    return;
  }

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

  renderSurvey();
});

preview.addEventListener("click", event => {
  if (!currentSurvey) return;

  const editIndex = event.target.dataset.edit;
  const deleteIndex = event.target.dataset.delete;

  if (editIndex !== undefined) {
    const input = preview.querySelector(`textarea[data-index="${editIndex}"]`);
    currentSurvey.questions[editIndex].text = input.value.trim();
    renderSurvey();
  }

  if (deleteIndex !== undefined) {
    currentSurvey.questions.splice(Number(deleteIndex), 1);
    renderSurvey();
  }
});

addQuestionBtn.addEventListener("click", () => {
  if (!currentSurvey) {
    alert("Please generate a survey first.");
    return;
  }

  currentSurvey.questions.push({
    text: `Write your question about ${currentSurvey.topic}.`,
    type: "short",
    options: []
  });

  renderSurvey();
});

saveSurveyBtn.addEventListener("click", async () => {
  if (!currentSurvey) {
    alert("Please generate a survey first.");
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
  alert("Survey saved successfully.");
});

printSurveyBtn.addEventListener("click", () => {
  if (!currentSurvey) {
    alert("Please generate a survey first.");
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
});

renderSavedSurveys();
