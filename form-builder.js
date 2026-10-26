(() => {
  const promptForm = document.getElementById("promptForm");
  const promptInput = document.getElementById("formPrompt");
  const promptCounter = document.getElementById("promptCounter");
  const generateButton = document.getElementById("generateFormBtn");
  const generateLabel = generateButton.querySelector(".generate-label");
  const generationStatus = document.getElementById("generationStatus");
  const generationBadge = document.getElementById("generationBadge");
  const emptyEditor = document.getElementById("formEditorEmpty");
  const formEditor = document.getElementById("formEditor");
  const formTitle = document.getElementById("formTitle");
  const formDescription = document.getElementById("formDescription");
  const fieldEditorList = document.getElementById("fieldEditorList");
  const savedFormsList = document.getElementById("savedFormsList");
  const saveFormButton = document.getElementById("saveFormBtn");
  const previewFormButton = document.getElementById("previewFormBtn");
  const downloadFormButton = document.getElementById("downloadDynamicFormBtn");
  const printFormButton = document.getElementById("printDynamicFormBtn");
  const viewResponsesButton = document.getElementById("viewResponsesBtn");
  const fillPreviewPanel = document.getElementById("fillPreviewPanel");
  const liveResponseForm = document.getElementById("liveResponseForm");
  const responsesPanel = document.getElementById("responsesPanel");
  const responseList = document.getElementById("responseList");
  const responseCountLabel = document.getElementById("responseCountLabel");
  const toast = document.getElementById("toast");
  const FIELD_TYPES = ["short_text", "long_text", "number", "email", "phone", "date", "dropdown", "radio", "checkboxes", "yes_no", "file"];
  const FIELD_TYPE_LABELS = {
    short_text: "Short text", long_text: "Long text", number: "Number", email: "Email",
    phone: "Phone number", date: "Date", dropdown: "Dropdown", radio: "Radio buttons",
    checkboxes: "Checkboxes", yes_no: "Yes / No", file: "File upload"
  };
  const CHOICE_TYPES = new Set(["dropdown", "radio", "checkboxes", "yes_no"]);
  const API_BASE = window.FORM_API_BASE || "";
  const LOCAL_FORMS_KEY = "aiDynamicForms";
  const LOCAL_RESPONSES_PREFIX = "aiDynamicFormResponses:";
  let currentForm = null;
  let noticeTimer;

  function escapeFormHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showNotice(target, message, kind = "info") {
    target.textContent = message;
    target.dataset.kind = kind;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
  }

  function makeId() {
    return globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}${Math.random().toString(16).slice(2)}`;
  }

  function localForms() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_FORMS_KEY)) || [];
    } catch (error) {
      return [];
    }
  }

  function saveLocalForms(forms) {
    localStorage.setItem(LOCAL_FORMS_KEY, JSON.stringify(forms));
  }

  function localResponses(formId) {
    try {
      return JSON.parse(localStorage.getItem(`${LOCAL_RESPONSES_PREFIX}${formId}`)) || [];
    } catch (error) {
      return [];
    }
  }

  function saveLocalResponse(formId, response) {
    const responses = localResponses(formId);
    responses.unshift(response);
    localStorage.setItem(`${LOCAL_RESPONSES_PREFIX}${formId}`, JSON.stringify(responses));
  }

  function defaultField(label = "New field", type = "short_text") {
    return { id: makeId(), label, type, required: false, options: type === "yes_no" ? ["Yes", "No"] : [], placeholder: "" };
  }

  function defaultOptionsFor(question) {
    if (question.type === "yes_no") return ["Yes", "No"];
    const name = question.label.toLowerCase();
    if (name.includes("semester") || name.includes("term")) return Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`);
    if (name.includes("division") || name.includes("section")) return ["A", "B", "C", "D", "Other"];
    if (name.includes("rating") || name.includes("experience")) return ["Excellent", "Good", "Average", "Poor"];
    return [];
  }

  function currentFieldById(id) {
    return currentForm?.questions.find(question => question.id === id);
  }

  function renderQuestionEditor(question, index) {
    const hasOptions = CHOICE_TYPES.has(question.type);
    const optionDefaults = hasOptions && !question.options?.length ? defaultOptionsFor(question) : (question.options || []);
    if (hasOptions && !question.options?.length && optionDefaults.length) question.options = optionDefaults;
    return `
      <article class="dynamic-field-card" data-question-id="${escapeFormHtml(question.id)}">
        <div class="dynamic-field-heading">
          <span class="field-order"><span class="field-order-dot">${String(index + 1).padStart(2, "0")}</span> FIELD ${index + 1}</span>
          <div class="field-reorder">
            <button type="button" data-move="up" aria-label="Move ${escapeFormHtml(question.label)} up" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-move="down" aria-label="Move ${escapeFormHtml(question.label)} down" ${index === currentForm.questions.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" data-delete-field aria-label="Delete ${escapeFormHtml(question.label)}">×</button>
          </div>
        </div>
        <label class="field-editor-label">Field label
          <input type="text" data-field-property="label" maxlength="160" value="${escapeFormHtml(question.label)}" required>
        </label>
        <div class="field-config-row">
          <label>Field type
            <select data-field-property="type">${FIELD_TYPES.map(type => `<option value="${type}" ${question.type === type ? "selected" : ""}>${FIELD_TYPE_LABELS[type]}</option>`).join("")}</select>
          </label>
          <label class="required-toggle"><input type="checkbox" data-field-property="required" ${question.required ? "checked" : ""}><span>Required</span></label>
        </div>
        ${hasOptions ? `<label class="field-editor-label option-editor">Options <span class="field-hint">Separate choices with commas or new lines.</span>
          <textarea data-field-property="options" rows="2" maxlength="1200">${escapeFormHtml(optionDefaults.join(", "))}</textarea>
        </label>` : ""}
        <label class="field-editor-label">Helper text <span class="optional-label">Optional</span>
          <input type="text" data-field-property="placeholder" maxlength="160" value="${escapeFormHtml(question.placeholder || "")}" placeholder="Add a hint for the person filling this in">
        </label>
      </article>`;
  }

  function renderEditor() {
    if (!currentForm) return;
    emptyEditor.hidden = true;
    formEditor.hidden = false;
    formTitle.value = currentForm.title || "";
    formDescription.value = currentForm.description || "";
    fieldEditorList.innerHTML = currentForm.questions.map(renderQuestionEditor).join("");
    const mode = currentForm.generationMode === "openai" ? "AI generated" : currentForm.generationMode === "browser-fallback" ? "Browser fallback" : "Rule-based fallback";
    generationBadge.textContent = mode;
    generationBadge.className = `generation-badge ${currentForm.generationMode === "openai" ? "is-ai" : "is-fallback"}`;
    generationBadge.hidden = false;
    previewFormButton.disabled = !currentForm.id || !currentForm.ownerToken;
    viewResponsesButton.disabled = !currentForm.id || !currentForm.ownerToken;
    showNotice(generationStatus, currentForm.generationNotice || "Review and edit the generated fields before saving.", currentForm.generationMode === "openai" ? "success" : "warning");
  }

  function parseOptions(value) {
    const values = value.split(/[\n,;]+/).map(option => option.trim()).filter(Boolean);
    const seen = new Set();
    return values.filter(option => {
      const normalized = option.toLocaleLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    }).slice(0, 30);
  }

  function browserFallbackForm(prompt) {
    const titleMatch = prompt.match(/(?:create|make|build|generate)\s+(?:me\s+)?(?:a|an)\s+(.{2,100}?\bform)\b/i)
      || prompt.match(/(?:title|form title)\s*:\s*([^\n.;]+)/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/[.!?]+$/, "") : "Custom Form";
    const listMatch = prompt.match(/(?:questions?|fields?|details|information)\s+(?:for|to collect|including|such as|like)\s+([^.!?\n]+)/i)
      || prompt.match(/(?:include|including|collect|capture|ask for)\s+([^.!?\n]+)/i);
    const inferType = label => {
      const text = label.toLowerCase();
      if (/e-?mail/.test(text)) return "email";
      if (/mobile|phone|telephone|contact number/.test(text)) return "phone";
      if (/date|birth|\bdob\b/.test(text)) return "date";
      if (/upload|attach|file|document|photo|image/.test(text)) return "file";
      if (/comment|feedback|suggestion|description|message|reason|address/.test(text)) return "long_text";
      if (/\b(age|quantity|count|amount|marks|score|rating)\b/.test(text)) return "number";
      if (/semester|term|division|section|branch|department|course|program|gender|category/.test(text)) return "dropdown";
      if (/yes\s*[/ -]?\s*no|consent|permission|agree/.test(text)) return "yes_no";
      return "short_text";
    };
    let questions = [];
    if (listMatch) {
      const seen = new Set();
      questions = listMatch[1].split(/\s*(?:,|;|\band\b|\bor\b)\s*/i)
        .map(label => label.trim().replace(/[.]+$/, ""))
        .filter(label => label.length > 1 && !seen.has(label.toLowerCase()) && seen.add(label.toLowerCase()))
        .map(label => {
          const type = inferType(label);
          let options = type === "yes_no" ? ["Yes", "No"] : [];
          if (type === "dropdown" && /semester|term/i.test(label)) options = Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`);
          else if (type === "dropdown" && /division|section/i.test(label)) options = ["A", "B", "C", "D", "Other"];
          else if (type === "dropdown" && /gender/i.test(label)) options = ["Female", "Male", "Non-binary", "Prefer not to say"];
          return { id: makeId(), label, type, required: !/\boptional\b/i.test(label), options, placeholder: "" };
        });
    }
    const category = `${title} ${prompt}`.toLowerCase();
    if (!questions.length && /student|enrollment|semester/.test(category)) {
      questions = ["Student Name", "Enrollment Number", "Division", "Branch", "Semester", "Email Address", "Mobile Number", "Date of Birth"].map(label => {
        const type = inferType(label);
        const options = /division/i.test(label) ? ["A", "B", "C", "D", "Other"] : /semester/i.test(label) ? Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`) : [];
        return { id: makeId(), label, type, required: true, options, placeholder: "" };
      });
    } else if (!questions.length && /feedback|review/.test(category)) {
      questions = [
        { id: makeId(), label: "Overall experience", type: "radio", required: true, options: ["Excellent", "Good", "Average", "Poor"], placeholder: "" },
        { id: makeId(), label: "What would you like us to improve?", type: "long_text", required: false, options: [], placeholder: "Share your suggestions" }
      ];
    } else if (!questions.length) {
      questions = ["Full Name", "Email Address"].map(label => ({ id: makeId(), label, type: inferType(label), required: true, options: [], placeholder: "" }));
    }
    return {
      id: makeId(), ownerToken: makeId(), title,
      description: `Complete this form to provide the requested ${title.replace(/\s+form$/i, "").toLowerCase()} information.`,
      prompt, questions, generationMode: "browser-fallback",
      generationNotice: "Flask is unavailable. Generated in your browser with a rule-based fallback. List the fields you need for the best match; this form and its responses stay in this browser until Flask is connected."
    };
  }

  function renderInput(question, index, standalone = false) {
    const name = `q_${question.id}`;
    const label = escapeFormHtml(question.label);
    const placeholder = escapeFormHtml(question.placeholder || "");
    const required = question.required ? "required" : "";
    const options = (question.options || []).map(option => escapeFormHtml(option));
    if (question.type === "short_text") return `<input type="text" name="${name}" placeholder="${placeholder}" ${required} maxlength="500">`;
    if (question.type === "long_text") return `<textarea name="${name}" rows="4" placeholder="${placeholder}" ${required} maxlength="5000"></textarea>`;
    if (question.type === "number") return `<input type="number" name="${name}" step="any" placeholder="${placeholder}" ${required}>`;
    if (question.type === "email") return `<input type="email" name="${name}" placeholder="${placeholder || "name@example.com"}" ${required} maxlength="254">`;
    if (question.type === "phone") return `<input type="tel" name="${name}" placeholder="${placeholder || "+1 555 000 0000"}" pattern="[+0-9() .-]{7,24}" title="Use 7–24 digits, spaces, or phone symbols." ${required} maxlength="24">`;
    if (question.type === "date") return `<input type="date" name="${name}" ${required}>`;
    if (question.type === "file") return `<input type="file" name="${name}" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt,.csv" ${required}>`;
    if (question.type === "dropdown") return `<select name="${name}" ${required}><option value="">Choose an option</option>${options.map(option => `<option value="${option}">${option}</option>`).join("")}</select>`;
    if (question.type === "radio" || question.type === "yes_no") return `<div class="choice-group">${options.map((option, optionIndex) => `<label class="choice-option"><input type="radio" name="${name}" value="${option}" ${question.required && optionIndex === 0 ? "required" : ""}><span>${option}</span></label>`).join("")}</div>`;
    if (question.type === "checkboxes") return `<div class="choice-group">${options.map(option => `<label class="choice-option"><input type="checkbox" name="${name}" value="${option}"><span>${option}</span></label>`).join("")}</div>`;
    return `<input type="text" name="${name}" aria-label="${label}" ${required}>`;
  }

  function renderLiveForm() {
    if (!currentForm) return;
    liveResponseForm.innerHTML = `
      <div class="live-form-intro"><span class="form-type-pill">FORM PREVIEW</span><h3>${escapeFormHtml(currentForm.title)}</h3><p>${escapeFormHtml(currentForm.description)}</p></div>
      ${currentForm.questions.map((question, index) => `
        <fieldset class="live-field" data-required="${question.required}" data-type="${question.type}" data-name="q_${escapeFormHtml(question.id)}">
          <legend><span class="live-field-number">${String(index + 1).padStart(2, "0")}</span>${escapeFormHtml(question.label)}${question.required ? `<span class="required-star" aria-label="required">*</span>` : ""}</legend>
          ${question.placeholder && !["short_text", "long_text", "email", "phone", "number"].includes(question.type) ? `<p class="live-helper">${escapeFormHtml(question.placeholder)}</p>` : ""}
          ${renderInput(question, index)}
          ${question.placeholder && ["short_text", "long_text", "email", "phone", "number"].includes(question.type) ? `<span class="live-helper">${escapeFormHtml(question.placeholder)}</span>` : ""}
        </fieldset>`).join("")}
      <div id="responseFormStatus" class="response-form-status" role="status" aria-live="polite"></div>
      <button type="submit" class="primary-btn submit-response-btn">Submit response <span aria-hidden="true">→</span></button>`;
    fillPreviewPanel.hidden = false;
    responsesPanel.hidden = true;
  }

  async function handlePromptSubmit(event) {
    event.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    generateButton.disabled = true;
    generateButton.classList.add("is-loading");
    generateLabel.textContent = "Thinking through your fields…";
    showNotice(generationStatus, "Reading your prompt and building the form…");
    let useBrowserFallback = false;
    try {
      const response = await fetch(`${API_BASE}/api/forms/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 400 || response.status === 422) throw new Error(data.error || "Please check your prompt and try again.");
        useBrowserFallback = true;
        throw new Error(data.error || "Flask backend is unavailable.");
      }
      if (!data.form || !Array.isArray(data.form.questions)) {
        useBrowserFallback = true;
        throw new Error("Flask returned an invalid form response.");
      }
      currentForm = { ...data.form, generationMode: data.generationMode, generationNotice: data.notice };
      renderEditor();
      showToast("Your form is ready to edit.");
      formEditor.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (useBrowserFallback || error.message.includes("Failed to fetch") || error.message.includes("not found") || error instanceof TypeError) {
        currentForm = browserFallbackForm(prompt);
        renderEditor();
        showToast("Form generated in browser mode.");
        formEditor.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        showNotice(generationStatus, error.message, "error");
      }
    } finally {
      generateButton.disabled = false;
      generateButton.classList.remove("is-loading");
      generateLabel.textContent = "Generate form";
    }
  }

  async function saveCurrentForm() {
    if (!currentForm) return;
    const title = formTitle.value.trim();
    if (!title) {
      showToast("Add a title before saving this form.");
      formTitle.focus();
      return;
    }
    if (!currentForm.questions.length) {
      showToast("Add at least one field before saving.");
      return;
    }
    const labels = new Set();
    for (const question of currentForm.questions) {
      question.label = question.label.trim();
      if (!question.label) {
        showToast("Every field needs a label.");
        return;
      }
      const normalized = question.label.toLocaleLowerCase();
      if (labels.has(normalized)) {
        showToast(`Remove or rename the duplicate field “${question.label}”.`);
        return;
      }
      labels.add(normalized);
      if (CHOICE_TYPES.has(question.type) && question.type !== "yes_no" && !(question.options || []).length) {
        showToast(`Add options for ${question.label}.`);
        return;
      }
    }
    currentForm.title = title;
    currentForm.description = formDescription.value.trim();
    currentForm.prompt = promptInput.value.trim();
    saveFormButton.disabled = true;
    saveFormButton.textContent = "Saving…";
    let saved = false;
    try {
      const headers = { "Content-Type": "application/json" };
      if (currentForm.ownerToken) headers["X-Form-Owner-Token"] = currentForm.ownerToken;
      const response = await fetch(`${API_BASE}/api/forms`, {
        method: "POST", headers, body: JSON.stringify({ form: currentForm })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) throw new Error(data.error || "The form could not be saved.");
      if (response.ok) {
        currentForm = { ...data.form, ownerToken: data.ownerToken || currentForm.ownerToken, generationNotice: currentForm.generationNotice };
        showNotice(document.getElementById("formSaveStatus"), "Saved to the Flask SQLite database.", "success");
        saved = true;
      } else {
        saveToBrowserStorage();
        showNotice(document.getElementById("formSaveStatus"), "Saved in this browser only. Start Flask to save forms to SQLite.", "warning");
        saved = true;
      }
    } catch (error) {
      if (error.message.includes("Failed to fetch")) {
        saveToBrowserStorage();
        showNotice(document.getElementById("formSaveStatus"), "Flask is not connected. Saved in this browser only; SQLite saving needs the Flask backend.", "warning");
        saved = true;
      } else {
        showNotice(document.getElementById("formSaveStatus"), error.message, "error");
      }
    } finally {
      saveFormButton.disabled = false;
      saveFormButton.textContent = "Save form";
    }
    if (saved) {
      renderEditor();
      await refreshSavedForms();
      showToast("Form saved.");
    }
  }

  function saveToBrowserStorage() {
    currentForm.id = currentForm.id || makeId();
    currentForm.ownerToken = currentForm.ownerToken || makeId();
    currentForm.createdAt = currentForm.createdAt || new Date().toISOString();
    currentForm.updatedAt = new Date().toISOString();
    const forms = localForms().filter(form => form.id !== currentForm.id);
    forms.unshift({ ...currentForm });
    saveLocalForms(forms);
  }

  async function refreshSavedForms() {
    let forms;
    try {
      const response = await fetch(`${API_BASE}/api/forms`);
      if (!response.ok) throw new Error("API unavailable");
      forms = await response.json();
      const local = localForms();
      forms = forms.map(form => ({ ...form, ownerToken: local.find(item => item.id === form.id)?.ownerToken || "" }));
    } catch (error) {
      forms = localForms();
    }
    if (!forms.length) {
      savedFormsList.innerHTML = '<p class="empty-library">No saved forms yet. Save a form and it will appear here.</p>';
      return;
    }
    savedFormsList.innerHTML = forms.map(form => `
      <article class="saved-form-item">
        <div class="saved-form-icon" aria-hidden="true">▤</div>
        <div class="saved-form-copy"><strong>${escapeFormHtml(form.title)}</strong><span>${Number(form.fieldCount ?? form.questions?.length ?? 0)} fields · ${Number(form.responseCount ?? localResponses(form.id).length)} responses</span></div>
        <button type="button" class="secondary-btn open-saved-form" data-open-form="${escapeFormHtml(form.id)}">Open</button>
      </article>`).join("");
  }

  async function openSavedForm(formId) {
    const local = localForms().find(form => form.id === formId);
    try {
      const response = await fetch(`${API_BASE}/api/forms/${encodeURIComponent(formId)}`);
      if (!response.ok) throw new Error("Saved form was not found.");
      const data = await response.json();
      currentForm = { ...data, ownerToken: local?.ownerToken || "", generationNotice: "Saved form loaded. You can edit it and save your changes." };
    } catch (error) {
      if (!local) {
        showToast("Could not load this form. Start Flask or open it in the browser where it was saved.");
        return;
      }
      currentForm = { ...local, generationNotice: "Loaded from this browser's local storage." };
    }
    promptInput.value = currentForm.prompt || "";
    promptCounter.textContent = `${promptInput.value.length} / 4000`;
    renderEditor();
    showToast("Saved form opened.");
    formEditor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitLiveResponse(event) {
    event.preventDefault();
    if (!currentForm?.id) return;
    for (const question of currentForm.questions) {
      if (question.required && question.type === "checkboxes") {
        const selected = liveResponseForm.querySelectorAll(`input[name="q_${question.id}"]:checked`);
        if (!selected.length) {
          showNotice(document.getElementById("responseFormStatus"), `Select at least one option for ${question.label}.`, "error");
          liveResponseForm.querySelector(`input[name="q_${question.id}"]`)?.focus();
          return;
        }
      }
    }
    const formData = new FormData(liveResponseForm);
    let responseData;
    try {
      const response = await fetch(`${API_BASE}/api/forms/${encodeURIComponent(currentForm.id)}/responses`, { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404) throw new Error("Flask response endpoint not found.");
      if (!response.ok) throw new Error(data.error || "Response could not be saved.");
      responseData = { id: data.responseId, createdAt: data.createdAt, answers: Object.fromEntries(currentForm.questions.map(question => {
        const name = `q_${question.id}`;
        return [name, question.type === "checkboxes" ? formData.getAll(name) : question.type === "file" ? formData.get(name)?.name || null : formData.get(name)];
      }).filter(([, value]) => value !== null)) };
      showNotice(document.getElementById("responseFormStatus"), "Response saved to the form database.", "success");
    } catch (error) {
      if (error.message.includes("Failed to fetch") || error.message.includes("not found") || error instanceof TypeError) {
        const answers = {};
        let hasFile = false;
        currentForm.questions.forEach(question => {
          const name = `q_${question.id}`;
          const value = question.type === "checkboxes" ? formData.getAll(name) : formData.get(name);
          if (question.type === "file" && value instanceof File) {
            if (value.name) hasFile = true;
            answers[name] = value.name || null;
          } else {
            answers[name] = value;
          }
        });
        responseData = { id: makeId(), createdAt: new Date().toISOString(), answers };
        saveLocalResponse(currentForm.id, responseData);
        showNotice(document.getElementById("responseFormStatus"), hasFile ? "Saved in this browser only; upload contents require Flask." : "Flask is offline. Saved in this browser only, not in SQLite.", "warning");
      } else {
        showNotice(document.getElementById("responseFormStatus"), error.message, "error");
        return;
      }
    }
    liveResponseForm.reset();
    await refreshSavedForms();
    showToast("Response submitted.");
  }

  async function loadResponses() {
    if (!currentForm?.id || !currentForm.ownerToken) {
      showToast("Save this form in this browser to access its private responses.");
      return;
    }
    let responses;
    try {
      const response = await fetch(`${API_BASE}/api/forms/${encodeURIComponent(currentForm.id)}/responses`, {
        headers: { "X-Form-Owner-Token": currentForm.ownerToken }
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || "Could not load responses.");
      responses = data;
    } catch (error) {
      if (error.message.includes("Failed to fetch") || error.message.includes("not found")) {
        responses = localResponses(currentForm.id);
      } else {
        showToast(error.message);
        return;
      }
    }
    renderResponses(responses);
    fillPreviewPanel.hidden = true;
    responsesPanel.hidden = false;
    responsesPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderResponses(responses) {
    responseCountLabel.textContent = `${responses.length} saved response${responses.length === 1 ? "" : "s"} for this form.`;
    if (!responses.length) {
      responseList.innerHTML = '<p class="empty-library">No responses yet. Use Preview &amp; fill to submit a response.</p>';
      return;
    }
    responseList.innerHTML = responses.map((response, index) => {
      const answers = response.answers || {};
      const pairs = currentForm.questions.map(question => {
        const value = answers[`q_${question.id}`];
        if (value === undefined || value === null || value === "") return "";
        const printable = Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
        return `<div class="response-answer"><strong>${escapeFormHtml(question.label)}</strong><span>${escapeFormHtml(printable)}</span></div>`;
      }).filter(Boolean).join("");
      const timestamp = response.createdAt ? new Date(response.createdAt).toLocaleString() : "Saved response";
      return `<details class="response-card"><summary><span>Response ${responses.length - index}</span><time>${escapeFormHtml(timestamp)}</time></summary><div class="response-answer-list">${pairs || "<p>No answers recorded.</p>"}</div></details>`;
    }).join("");
  }

  function downloadFile(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadFormHtml() {
    if (!currentForm) return;
    const safeDefinition = JSON.stringify({ title: currentForm.title, description: currentForm.description, questions: currentForm.questions }).replaceAll("<", "\\u003c");
    const formMarkup = currentForm.questions.map((question, index) => `
      <fieldset><legend><span>FIELD ${String(index + 1).padStart(2, "0")}</span>${escapeFormHtml(question.label)}${question.required ? " *" : ""}</legend>
        ${question.placeholder ? `<p class="hint">${escapeFormHtml(question.placeholder)}</p>` : ""}${renderInput(question, index, true)}
      </fieldset>`).join("");
    const content = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeFormHtml(currentForm.title)}</title><style>
      *{box-sizing:border-box}body{margin:0;padding:36px 16px;background:#f6f6fc;color:#20233f;font:16px/1.5 Arial,sans-serif}main{max-width:760px;margin:auto;padding:30px;background:#fff;border:1px solid #e3e5f0;border-radius:18px;box-shadow:0 18px 48px rgba(38,39,88,.09)}h1{margin:0 0 6px;font-size:28px}.desc,.hint{color:#70758f}fieldset{margin:18px 0;padding:18px;border:1px solid #e3e5f0;border-radius:13px}legend{padding:0 5px;font-weight:bold}legend span{display:block;color:#6658d3;font-size:11px;letter-spacing:.08em}input,select,textarea{width:100%;padding:12px;border:1px solid #dfe1ed;border-radius:9px;font:inherit}.choice-group{display:grid;gap:9px}.choice-option{display:flex;align-items:center;gap:10px;padding:11px;border:1px solid #e7e6f2;border-radius:9px}.choice-option input{width:auto;accent-color:#6658d3}button{padding:13px 18px;border:0;border-radius:9px;color:#fff;background:#6658d3;font-weight:bold;cursor:pointer}@media(max-width:520px){main{padding:20px}}
    </style></head><body><main><h1>${escapeFormHtml(currentForm.title)}</h1><p class="desc">${escapeFormHtml(currentForm.description)}</p><form id="offlineForm">${formMarkup}<button type="submit">Download response</button><p id="done" role="status"></p></form></main><script>
      const definition=${safeDefinition};document.getElementById('offlineForm').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);const answers={};for(const q of definition.questions){const key='q_'+q.id;answers[key]=q.type==='checkboxes'?data.getAll(key):q.type==='file'?(data.get(key)?.name||null):data.get(key)}const blob=new Blob([JSON.stringify({formTitle:definition.title,submittedAt:new Date().toISOString(),answers},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='form-response.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);document.getElementById('done').textContent='Your response file was downloaded. This standalone form does not send responses to the database.'});
    <\/script></body></html>`;
    const filename = currentForm.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom-form";
    downloadFile(content, "text/html;charset=utf-8", `${filename}.html`);
    showToast("Standalone form downloaded.");
  }

  async function submitAllResponsesDownload() {
    if (!currentForm) return;
    let responses;
    try {
      const response = await fetch(`${API_BASE}/api/forms/${encodeURIComponent(currentForm.id)}/responses`, {
        headers: { "X-Form-Owner-Token": currentForm.ownerToken || "" }
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || "Could not load responses.");
      responses = data;
    } catch (error) {
      responses = localResponses(currentForm.id);
    }
    downloadFile(JSON.stringify({ form: currentForm.title, responses }, null, 2), "application/json", "form-responses.json");
  }

  promptForm.addEventListener("submit", handlePromptSubmit);
  promptInput.addEventListener("input", () => { promptCounter.textContent = `${promptInput.value.length} / 4000`; });
  formTitle.addEventListener("input", () => { if (currentForm) currentForm.title = formTitle.value; });
  formDescription.addEventListener("input", () => { if (currentForm) currentForm.description = formDescription.value; });

  fieldEditorList.addEventListener("input", event => {
    const card = event.target.closest("[data-question-id]");
    if (!card || !currentForm) return;
    const question = currentFieldById(card.dataset.questionId);
    if (!question) return;
    const property = event.target.dataset.fieldProperty;
    if (property === "label" || property === "placeholder") question[property] = event.target.value;
    if (property === "options") question.options = question.type === "yes_no" ? ["Yes", "No"] : parseOptions(event.target.value);
  });

  fieldEditorList.addEventListener("change", event => {
    const card = event.target.closest("[data-question-id]");
    if (!card || !currentForm) return;
    const question = currentFieldById(card.dataset.questionId);
    if (!question) return;
    const property = event.target.dataset.fieldProperty;
    if (property === "required") question.required = event.target.checked;
    if (property === "type") {
      question.type = event.target.value;
      question.options = question.type === "yes_no" ? ["Yes", "No"] : CHOICE_TYPES.has(question.type) ? defaultOptionsFor(question) : [];
      renderEditor();
    }
  });

  fieldEditorList.addEventListener("click", event => {
    const card = event.target.closest("[data-question-id]");
    if (!card || !currentForm) return;
    const index = currentForm.questions.findIndex(question => question.id === card.dataset.questionId);
    if (index < 0) return;
    if (event.target.closest("[data-delete-field]")) {
      currentForm.questions.splice(index, 1);
      renderEditor();
      showToast("Field removed.");
    }
    const move = event.target.closest("[data-move]")?.dataset.move;
    if (move) {
      const destination = move === "up" ? index - 1 : index + 1;
      if (destination < 0 || destination >= currentForm.questions.length) return;
      [currentForm.questions[index], currentForm.questions[destination]] = [currentForm.questions[destination], currentForm.questions[index]];
      renderEditor();
    }
  });

  document.getElementById("addFieldBtn").addEventListener("click", () => {
    if (!currentForm) return;
    currentForm.questions.push(defaultField());
    renderEditor();
    fieldEditorList.lastElementChild?.querySelector("input[data-field-property='label']")?.focus();
    showToast("New field added.");
  });

  saveFormButton.addEventListener("click", saveCurrentForm);
  previewFormButton.addEventListener("click", () => {
    if (!currentForm?.ownerToken) return;
    renderLiveForm();
    fillPreviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("closePreviewBtn").addEventListener("click", () => { fillPreviewPanel.hidden = true; });
  liveResponseForm.addEventListener("submit", submitLiveResponse);
  downloadFormButton.addEventListener("click", downloadFormHtml);
  printFormButton.addEventListener("click", () => {
    if (!fillPreviewPanel.hidden) {
      document.body.classList.add("print-form-mode");
      window.print();
      document.body.classList.remove("print-form-mode");
      return;
    }
    if (currentForm?.ownerToken) {
      renderLiveForm();
      document.body.classList.add("print-form-mode");
      window.print();
      document.body.classList.remove("print-form-mode");
    } else {
      showToast("Save the form before printing its fillable preview.");
    }
  });
  viewResponsesButton.addEventListener("click", loadResponses);
  document.getElementById("downloadResponsesBtn").addEventListener("click", submitAllResponsesDownload);
  document.getElementById("refreshFormsBtn").addEventListener("click", refreshSavedForms);
  savedFormsList.addEventListener("click", event => {
    const openButton = event.target.closest("[data-open-form]");
    if (openButton) openSavedForm(openButton.dataset.openForm);
  });

  refreshSavedForms();
})();
