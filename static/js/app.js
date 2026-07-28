// LastMinute.AI - Client Frontend JavaScript Controller

// Global App State
const state = {
  activeTab: 'dashboard',
  apiConfigured: false,
  apiProvider: 'none',
  resumeAnalysis: null,
  activeDocumentId: null,
  activeDocumentName: null,
  activeDocumentIds: [], // Multi-select support
  uploadedDocuments: [], // Array of { id, name, chunks }
  studyPlan: null,
  // Quiz states
  quizTopic: '',
  quizMCQs: [],
  quizFlashcards: [],
  currentMCQIdx: 0,
  currentFlashcardIdx: 0,
  quizScore: 0,
  quizCompletedCount: 0,
  // Chat History states
  chatbotHistory: [], // Format: { role: 'user'|'model', text: string }
  pinnedGoals: []
};

// Panel Info Configuration for Header Updates
const panelHeaders = {
  'dashboard': {
    title: 'Dashboard',
    subtitle: 'Welcome back, Student! Here is your learning progress.'
  },
  'resume-gap': {
    title: 'Resume & Skill Gap Analyzer',
    subtitle: 'Find out how your resume aligns with job listings and get custom study guides.'
  },
  'study-assistant': {
    title: 'Personalized Study Assistant',
    subtitle: 'Generate customized study plans and practice quizzes to master any topic.'
  },
  'document-qa': {
    title: 'Document Question & Answering',
    subtitle: 'Upload study files and ask questions to search and extract context.'
  },
  'tutor-chatbot': {
    title: 'AI Academic Tutor',
    subtitle: 'Ask general homework questions, seek programming help, or request concept breakdowns.'
  },
  'settings': {
    title: 'Settings & API Config',
    subtitle: 'Configure your LLM API Key to enable all platform features.'
  }
};

// Startup Initializations
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();
  
  // Set up Sidebar Tab Navigation
  setupTabNavigation();
  
  // Set up File Drag & Drop
  setupFileDropAreas();
  
  // Verify API Key Configuration
  checkApiKeyStatus();

  // Bind Form Submit Handlers
  setupFormHandlers();
  
  // Initialize dynamic views
  updateDashboardViews();

  // Load database items on startup
  loadUploadedDocuments();
  loadPinnedGoals();

  // Init Typing Effect
  initTypingEffect();
});

// Custom Toast Engine
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  else if (type === 'warning') iconName = 'alert-triangle';
  else if (type === 'danger') iconName = 'alert-octagon';

  toast.innerHTML = `
    <i data-lucide="${iconName}" class="toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  // Transition in
  setTimeout(() => {
    toast.classList.add('show');
  }, 50);

  // Transition out & remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 4000);
}

// Typing Effect for Dashboard Banner
function initTypingEffect() {
  const words = ["coding concepts.", "internship resumes.", "study plans.", "textbooks in seconds."];
  let wordIdx = 0;
  let charIdx = 0;
  let isDeleting = false;
  const target = document.getElementById('typing-text');
  if (!target) return;

  function type() {
    const currentWord = words[wordIdx];
    if (isDeleting) {
      target.innerText = currentWord.substring(0, charIdx - 1);
      charIdx--;
    } else {
      target.innerText = currentWord.substring(0, charIdx + 1);
      charIdx++;
    }

    let typeSpeed = 90;
    if (isDeleting) {
      typeSpeed /= 2;
    }

    if (!isDeleting && charIdx === currentWord.length) {
      typeSpeed = 1600; // Pause at end
      isDeleting = true;
    } else if (isDeleting && charIdx === 0) {
      isDeleting = false;
      wordIdx = (wordIdx + 1) % words.length;
      typeSpeed = 400; // Pause before typing next
    }

    setTimeout(type, typeSpeed);
  }

  setTimeout(type, 600);
}

// Format Markdown Code Blocks with Copy Bar
function formatCodeBlocks(container) {
  const preBlocks = container.querySelectorAll('pre');
  preBlocks.forEach(pre => {
    if (pre.querySelector('.code-header') || pre.parentNode.classList.contains('code-block-wrapper')) return;

    const code = pre.querySelector('code');
    if (!code) return;

    // Extract language name
    let lang = 'CODE';
    code.className.split(' ').forEach(cls => {
      if (cls.startsWith('language-')) {
        lang = cls.replace('language-', '').toUpperCase();
      }
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const header = document.createElement('div');
    header.className = 'code-header';
    header.innerHTML = `
      <span class="code-lang">${lang}</span>
      <button class="code-copy-btn" onclick="copyCodeText(this)">
        <i data-lucide="copy" class="copy-icon"></i> Copy
      </button>
    `;

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
  lucide.createIcons();
}

window.copyCodeText = function(button) {
  const wrapper = button.closest('.code-block-wrapper');
  const pre = wrapper.querySelector('pre');
  const codeText = pre.querySelector('code').innerText;

  navigator.clipboard.writeText(codeText).then(() => {
    button.innerHTML = '<i data-lucide="check" class="copy-icon"></i> Copied!';
    lucide.createIcons();
    setTimeout(() => {
      button.innerHTML = '<i data-lucide="copy" class="copy-icon"></i> Copy';
      lucide.createIcons();
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy code: ', err);
    showToast('Failed to copy code.', 'danger');
  });
};

// 1. Navigation & Tab Switching
function setupTabNavigation() {
  const menuButtons = document.querySelectorAll('.menu-item');
  menuButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Subtab switching (Study Assistant: Planner vs Quiz)
  const subtabButtons = document.querySelectorAll('.tab-subnav button');
  subtabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      subtabButtons.forEach(b => b.classList.remove('sub-tabactive'));
      document.querySelectorAll('.subtab-content').forEach(c => c.style.display = 'none');
      
      btn.classList.add('sub-tabactive');
      const subtabId = btn.getAttribute('data-subtab');
      document.getElementById(`subtab-${subtabId}`).style.display = 'flex';
      
      lucide.createIcons();
    });
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  
  document.querySelectorAll('.menu-item').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const headerInfo = panelHeaders[tabId];
  if (headerInfo) {
    document.getElementById('current-panel-title').innerText = headerInfo.title;
    document.getElementById('current-panel-subtitle').innerText = headerInfo.subtitle;
  }

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  
  const targetPanel = document.getElementById(`panel-${tabId}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }
  
  lucide.createIcons();
}

// 2. API Key verification
async function checkApiKeyStatus() {
  try {
    const res = await fetch('/api/check-key');
    const data = await res.json();
    state.apiConfigured = data.configured;
    state.apiProvider = data.provider;
    updateApiBadge();
  } catch (err) {
    console.error('Error checking API status:', err);
  }
}

function updateApiBadge() {
  const badge = document.getElementById('api-status-indicator');
  const text = document.getElementById('api-status-text');
  const icon = document.getElementById('api-status-icon');
  
  if (state.apiConfigured) {
    badge.className = 'api-status-badge configured';
    text.innerText = state.apiProvider === 'groq' ? 'Groq Active' : 'Gemini Active';
    icon.setAttribute('data-lucide', 'check-circle-2');
  } else {
    badge.className = 'api-status-badge missing';
    text.innerText = 'LLM Offline';
    icon.setAttribute('data-lucide', 'alert-circle');
  }
  lucide.createIcons();
}

// 3. File Drag and Drop Handlers
function setupFileDropAreas() {
  setupSingleDropArea('resume-drag-area', 'resume-file-input', 'selected-resume-name', (file) => {
    if (!file.name.endsWith('.pdf') && !file.name.endsWith('.docx')) {
      showToast('Only PDF and DOCX files are supported.', 'warning');
      return false;
    }
    return true;
  });

  const docInput = document.getElementById('doc-file-input');
  const docDragArea = document.getElementById('doc-drag-area');
  
  docDragArea.addEventListener('click', () => docInput.click());
  
  docDragArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    docDragArea.classList.add('drag-over');
  });
  
  docDragArea.addEventListener('dragleave', () => {
    docDragArea.classList.remove('drag-over');
  });
  
  docDragArea.addEventListener('drop', (e) => {
    e.preventDefault();
    docDragArea.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleDocUpload(e.dataTransfer.files[0]);
    }
  });
  
  docInput.addEventListener('change', () => {
    if (docInput.files.length > 0) {
      handleDocUpload(docInput.files[0]);
    }
  });
}

function setupSingleDropArea(areaId, inputId, labelId, validationFn) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);

  area.addEventListener('click', () => input.click());

  area.addEventListener('dragover', (e) => {
    e.preventDefault();
    area.classList.add('drag-over');
  });

  area.addEventListener('dragleave', () => {
    area.classList.remove('drag-over');
  });

  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('drag-over');
    
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (validationFn(file)) {
        input.files = e.dataTransfer.files;
        label.innerText = `Selected: ${file.name}`;
        label.style.display = 'inline-block';
      }
    }
  });

  input.addEventListener('change', () => {
    if (input.files.length > 0) {
      const file = input.files[0];
      if (validationFn(file)) {
        label.innerText = `Selected: ${file.name}`;
        label.style.display = 'inline-block';
      }
    }
  });
}

// 4. API Form submissions and actions
function setupFormHandlers() {
  const providerSelect = document.getElementById('settings-provider-select');
  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      const provider = providerSelect.value;
      const label = document.getElementById('key-input-label');
      const input = document.getElementById('api-key-input');
      if (provider === 'groq') {
        label.innerText = 'Groq API Key';
        input.placeholder = 'Paste Groq key here (gsk_...)';
      } else {
        label.innerText = 'Gemini API Key';
        input.placeholder = 'Paste Gemini key here (AIzaSy...)';
      }
    });
  }

  // Save API Key Settings
  const settingsForm = document.getElementById('settings-key-form');
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = document.getElementById('settings-provider-select').value;
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) return;

    const btn = document.getElementById('save-key-btn');
    btn.disabled = true;
    btn.innerText = 'Saving...';

    try {
      const res = await fetch('/api/save-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, provider: provider })
      });
      const data = await res.json();
      if (data.success) {
        state.apiConfigured = true;
        state.apiProvider = provider;
        updateApiBadge();
        showToast(`${provider.toUpperCase()} API key saved successfully!`, 'success');
        document.getElementById('api-key-input').value = '';
      } else {
        showToast('Error: ' + data.error, 'danger');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error while saving API key.', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerText = 'Save API Key';
    }
  });

  // Resume Analysis Form Submit
  const resumeForm = document.getElementById('resume-analysis-form');
  resumeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fileInput = document.getElementById('resume-file-input');
    const jdInput = document.getElementById('job-description-input').value.trim();
    
    if (fileInput.files.length === 0 || !jdInput) {
      showToast('Please select a resume file and enter a job description.', 'warning');
      return;
    }
    
    const textSpan = document.getElementById('analyze-btn-text');
    const spinner = document.getElementById('analyze-btn-spinner');
    const submitBtn = document.getElementById('analyze-resume-btn');
    
    textSpan.innerText = 'Analyzing Skill Gap...';
    spinner.style.display = 'block';
    submitBtn.disabled = true;
    
    document.getElementById('resume-empty-state').style.display = 'none';
    document.getElementById('resume-results-view').style.display = 'none';

    const formData = new FormData();
    formData.append('resume', fileInput.files[0]);
    formData.append('job_description', jdInput);

    try {
      const res = await fetch('/api/analyze-resume', {
        method: 'POST',
        headers: {
          'X-Groq-API-Key': sessionGetApiKey()
        },
        body: formData
      });
      
      const data = await res.json();
      if (res.ok) {
        state.resumeAnalysis = data;
        renderResumeResults(data);
        showToast('Skill gap analysis complete!', 'success');
      } else {
        showToast('Error: ' + (data.error || 'Server error during analysis'), 'danger');
        document.getElementById('resume-empty-state').style.display = 'flex';
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to connect to the server.', 'danger');
      document.getElementById('resume-empty-state').style.display = 'flex';
    } finally {
      textSpan.innerText = 'Analyze Skill Alignment';
      spinner.style.display = 'none';
      submitBtn.disabled = false;
    }
  });

  // Study Plan Form Submit
  const planForm = document.getElementById('study-plan-form');
  planForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const target = document.getElementById('plan-target').value.trim();
    const duration = document.getElementById('plan-duration').value;
    const hours = document.getElementById('plan-hours').value;
    const level = document.getElementById('plan-level').value;
    const currentSkills = document.getElementById('plan-current-skills').value.trim();

    const spinner = document.getElementById('plan-btn-spinner');
    const btnText = document.getElementById('plan-btn-text');
    const btn = document.getElementById('generate-plan-btn');

    spinner.style.display = 'block';
    btnText.innerText = 'Generating Planner...';
    btn.disabled = true;

    document.getElementById('plan-empty-state').style.display = 'none';
    document.getElementById('plan-display-view').style.display = 'none';

    try {
      const res = await fetch('/api/study-assistant/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Groq-API-Key': sessionGetApiKey()
        },
        body: JSON.stringify({
          target_role: target,
          duration_weeks: duration,
          hours_per_week: hours,
          skill_level: level,
          current_skills: currentSkills
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        state.studyPlan = {
          target: target,
          duration: duration,
          planText: data.plan
        };
        renderStudyPlan(data.plan);
        showToast('Study Plan generated successfully!', 'success');
      } else {
        showToast('Error: ' + (data.error || 'Could not generate study plan'), 'danger');
        document.getElementById('plan-empty-state').style.display = 'flex';
      }
    } catch (err) {
      console.error(err);
      showToast('Server communication error.', 'danger');
      document.getElementById('plan-empty-state').style.display = 'flex';
    } finally {
      spinner.style.display = 'none';
      btnText.innerText = 'Generate Study Plan';
      btn.disabled = false;
    }
  });

  // Quiz Form Submit
  const quizForm = document.getElementById('quiz-generation-form');
  quizForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const topic = document.getElementById('quiz-topic-input').value.trim();
    if (!topic) return;

    const spinner = document.getElementById('quiz-btn-spinner');
    const btnText = document.getElementById('quiz-btn-text');
    const btn = document.getElementById('generate-quiz-btn');

    spinner.style.display = 'block';
    btnText.innerText = 'Creating Test...';
    btn.disabled = true;

    document.getElementById('quiz-empty-state').style.display = 'none';
    document.getElementById('quiz-interface-view').style.display = 'none';
    document.getElementById('quiz-results-view').style.display = 'none';
    document.getElementById('flashcards-section').style.display = 'none';

    try {
      const res = await fetch('/api/study-assistant/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Groq-API-Key': sessionGetApiKey()
        },
        body: JSON.stringify({ topic: topic })
      });
      const data = await res.json();
      
      if (res.ok && !data.error) {
        state.quizTopic = topic;
        state.quizMCQs = data.mcqs;
        state.quizFlashcards = data.flashcards;
        state.currentMCQIdx = 0;
        state.currentFlashcardIdx = 0;
        state.quizScore = 0;
        
        setupQuizInterface();
        setupFlashcardDeck();
        showToast('Assessment materials generated!', 'success');
      } else {
        showToast('Error: ' + (data.error || 'Failed to create assessment quiz.'), 'danger');
        document.getElementById('quiz-empty-state').style.display = 'flex';
      }
    } catch (err) {
      console.error(err);
      showToast('Error connecting to quiz server.', 'danger');
      document.getElementById('quiz-empty-state').style.display = 'flex';
    } finally {
      spinner.style.display = 'none';
      btnText.innerText = 'Generate Practice Quiz';
      btn.disabled = false;
    }
  });

  // Document QA Chat Submission
  const docChatForm = document.getElementById('doc-chat-input-form');
  docChatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('doc-chat-input');
    const queryText = input.value.trim();
    if (!queryText || state.activeDocumentIds.length === 0) return;

    appendDocChatMessage('user', queryText);
    input.value = '';
    
    const loadingBubble = appendDocChatMessage('model', '<div class="spinner"></div>');
    
    try {
      const res = await fetch('/api/query-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Groq-API-Key': sessionGetApiKey()
        },
        body: JSON.stringify({
          document_ids: state.activeDocumentIds,
          question: queryText
        })
      });
      const data = await res.json();
      
      loadingBubble.remove();
      
      if (res.ok && data.success) {
        appendDocChatMessage('model', data.answer, data.sources);
      } else {
        appendDocChatMessage('model', `Failed to retrieve answer: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(err);
      loadingBubble.remove();
      appendDocChatMessage('model', 'Failed to retrieve answer due to network error.');
    }
  });

  // AI Tutor Chat Form Submit
  const tutorChatForm = document.getElementById('tutor-chat-input-form');
  tutorChatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('tutor-chat-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    sendTutorMessage(message);
  });
}

// 5. Result Rendering Functions

// A: Resume Gap Result Rendering
function renderResumeResults(data) {
  document.getElementById('resume-results-view').style.display = 'block';
  
  const score = Math.round(data.ats_score);
  const circle = document.getElementById('ats-score-circle');
  if (circle) {
    circle.setAttribute('stroke-dasharray', `${score}, 100`);
    if (score >= 80) {
      circle.style.stroke = 'var(--success, #10b981)';
    } else if (score >= 60) {
      circle.style.stroke = 'var(--accent-secondary, #f59e0b)';
    } else {
      circle.style.stroke = 'var(--warning, #ef4444)';
    }
  }
  const scoreText = document.getElementById('ats-score-text');
  if (scoreText) {
    scoreText.textContent = `${score}%`;
  }
  
  const valEl = document.getElementById('ats-score-text-val');
  if (valEl) {
    valEl.innerText = `${score}%`;
    if (score >= 80) {
      valEl.style.color = 'var(--success)';
    } else if (score >= 60) {
      valEl.style.color = 'var(--accent-secondary)';
    } else {
      valEl.style.color = 'var(--warning)';
    }
  }
  
  const label = document.getElementById('ats-score-label');
  if (score >= 80) {
    label.innerText = 'Excellent Match';
    label.style.color = 'var(--success)';
  } else if (score >= 60) {
    label.innerText = 'Strong Potential Match';
    label.style.color = 'var(--accent-secondary)';
  } else {
    label.innerText = 'Suboptimal Match';
    label.style.color = 'var(--warning)';
  }

  document.getElementById('matched-skills-count').innerText = `${data.matched_skills.length} Matched`;
  document.getElementById('missing-skills-count').innerText = `${data.missing_skills.length} Missing`;
  
  const matchedContainer = document.getElementById('matched-skills-tags');
  matchedContainer.innerHTML = '';
  if (data.matched_skills.length > 0) {
    data.matched_skills.forEach(skill => {
      matchedContainer.innerHTML += `<span class="skill-tag matched-skills-tag">${skill}</span>`;
    });
  } else {
    matchedContainer.innerHTML = '<span class="text-muted" style="font-size: 0.8rem;">No skills matched yet</span>';
  }

  const missingContainer = document.getElementById('missing-skills-tags');
  missingContainer.innerHTML = '';
  if (data.missing_skills.length > 0) {
    data.missing_skills.forEach(skill => {
      missingContainer.innerHTML += `<span class="skill-tag missing-skills-tag">${skill}</span>`;
    });
  } else {
    missingContainer.innerHTML = '<span class="text-muted" style="font-size: 0.8rem;">No missing skills detected</span>';
  }

  const markdownDiv = document.getElementById('analysis-suggestions-markdown');
  markdownDiv.innerHTML = marked.parse(data.suggestions);
  formatCodeBlocks(markdownDiv);

  // Render Skill Gap Graph
  renderSkillsRadarChart(data.matched_skills, data.missing_skills);

  document.getElementById('dash-ats-score').innerText = `${score}%`;
  document.getElementById('dash-skills-count').innerText = data.resume_skills.length;
  state.resumeAnalysis = data;
  updateDashboardViews();
}

// B: Study Plan Rendering
function renderStudyPlan(markdownPlan) {
  document.getElementById('plan-display-view').style.display = 'block';
  const container = document.getElementById('plan-markdown-content');
  container.innerHTML = marked.parse(markdownPlan);
  formatCodeBlocks(container);
  
  const pinBtn = document.getElementById('save-plan-to-dash-btn');
  pinBtn.onclick = () => {
    if (state.studyPlan) {
      pinPlanToDashboard(state.studyPlan);
      showToast('Plan pinned to Dashboard goals!', 'success');
    }
  };
}

async function pinPlanToDashboard(plan) {
  try {
    const res = await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: plan.target,
        duration: plan.duration,
        plan_text: plan.planText
      })
    });
    const data = await res.json();
    if (data.success) {
      loadPinnedGoals();
    }
  } catch (err) {
    console.error('Failed to pin goal:', err);
  }
}

// C: Dashboard view sync
function updateDashboardViews() {
  const goalsContainer = document.getElementById('dashboard-goals-list');
  goalsContainer.innerHTML = '';

  if (state.pinnedGoals.length === 0) {
    goalsContainer.innerHTML = `
      <div class="empty-state">
        <i data-lucide="plus-circle" class="empty-icon"></i>
        <p>No active study plans pinned. Go to Study Assistant to generate one!</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  state.pinnedGoals.forEach((goal, idx) => {
    goalsContainer.innerHTML += `
      <div class="goal-item">
        <div class="goal-title-row">
          <h5>${goal.target}</h5>
          <span class="goal-duration">${goal.duration} Weeks Plan</span>
        </div>
        <div class="progress-bar-bg" style="margin-bottom: 8px;">
          <div class="progress-bar-fill" style="width: ${goal.progress}%;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size: 0.75rem; color: var(--text-muted);">Progress: ${goal.progress}%</span>
          <button class="btn btn-secondary btn-sm" onclick="incrementGoalProgress(${idx})" style="padding: 2px 8px; font-size: 0.7rem;">Update</button>
        </div>
      </div>
    `;
  });
  
  document.getElementById('dash-docs-count').innerText = state.uploadedDocuments.length;
  document.getElementById('dash-quizzes-count').innerText = state.quizCompletedCount;
  
  lucide.createIcons();
}

async function incrementGoalProgress(idx) {
  const goal = state.pinnedGoals[idx];
  if (goal) {
    const newProgress = Math.min(100, goal.progress + 10);
    try {
      const res = await fetch('/api/goals/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: goal.target,
          progress: newProgress
        })
      });
      const data = await res.json();
      if (data.success) {
        goal.progress = newProgress;
        updateDashboardViews();
      }
    } catch (err) {
      console.error('Failed to update progress:', err);
    }
  }
}

// 6. Practice Assessment: Quiz & Flashcards

// MCQ Implementation
function setupQuizInterface() {
  document.getElementById('quiz-interface-view').style.display = 'block';
  document.getElementById('quiz-topic-title').innerText = `Self-Assessment: ${state.quizTopic}`;
  renderMCQQuestion();
}

function renderMCQQuestion() {
  const progressFill = document.getElementById('quiz-progress-fill');
  const progressLabel = document.getElementById('quiz-progress-label');
  const mcq = state.quizMCQs[state.currentMCQIdx];

  const progressPercent = ((state.currentMCQIdx) / state.quizMCQs.length) * 100;
  progressFill.style.width = `${progressPercent}%`;
  progressLabel.innerText = `Question ${state.currentMCQIdx + 1} of ${state.quizMCQs.length}`;

  document.getElementById('quiz-question-text').innerText = mcq.question;
  
  document.getElementById('quiz-explanation-container').style.display = 'none';
  document.getElementById('quiz-next-btn').style.display = 'none';

  const container = document.getElementById('quiz-options-container');
  container.innerHTML = '';

  mcq.options.forEach((opt, idx) => {
    const item = document.createElement('div');
    item.className = 'quiz-option';
    item.innerText = opt;
    item.onclick = () => selectQuizOption(idx, item);
    container.appendChild(item);
  });
}

function selectQuizOption(selectedIdx, optionElement) {
  const mcq = state.quizMCQs[state.currentMCQIdx];
  const correctIdx = mcq.answer_idx;
  const options = document.querySelectorAll('.quiz-option');

  options.forEach(opt => opt.classList.add('disabled'));

  const expBox = document.getElementById('quiz-explanation-container');
  const expTitle = document.getElementById('explanation-title');
  const expBody = document.getElementById('explanation-body');
  const expIcon = document.getElementById('explanation-status-icon');

  if (selectedIdx === correctIdx) {
    optionElement.classList.add('correct');
    state.quizScore++;
    expBox.className = 'quiz-explanation-box correct';
    expTitle.innerText = 'Correct Answer!';
    expIcon.innerHTML = '<i data-lucide="check-circle"></i>';
    expBody.innerText = mcq.explanation;
  } else {
    optionElement.classList.add('incorrect');
    options[correctIdx].classList.add('correct');
    expBox.className = 'quiz-explanation-box incorrect';
    expTitle.innerText = 'Incorrect';
    expIcon.innerHTML = '<i data-lucide="x-circle"></i>';
    expBody.innerText = mcq.explanation;
  }

  lucide.createIcons();
  expBox.style.display = 'flex';
  document.getElementById('quiz-next-btn').style.display = 'inline-flex';
}

function advanceQuiz() {
  const qBox = document.querySelector('.quiz-question-box');
  qBox.classList.add('fade-out');
  
  setTimeout(() => {
    state.currentMCQIdx++;
    if (state.currentMCQIdx < state.quizMCQs.length) {
      renderMCQQuestion();
      qBox.classList.remove('fade-out');
      qBox.classList.add('fade-in');
      setTimeout(() => qBox.classList.remove('fade-in'), 300);
    } else {
      document.getElementById('quiz-interface-view').style.display = 'none';
      const resultsView = document.getElementById('quiz-results-view');
      resultsView.style.display = 'flex';
      document.getElementById('quiz-final-score').innerText = `${state.quizScore} / ${state.quizMCQs.length}`;
      
      const feedback = document.getElementById('quiz-results-feedback');
      const ratio = state.quizScore / state.quizMCQs.length;
      if (ratio >= 0.8) {
        feedback.innerText = 'Excellent job! You have demonstrated a strong, comprehensive understanding of this topic.';
      } else if (ratio >= 0.5) {
        feedback.innerText = 'Good attempt. You have a fair understanding but reviewing the flashcards could help lock in key points.';
      } else {
        feedback.innerText = 'Consider re-reading your study material and study guide, then trying the quiz again to build confidence.';
      }
      
      state.quizCompletedCount++;
      updateDashboardViews();
    }
  }, 300);
}

function restartQuiz() {
  state.currentMCQIdx = 0;
  state.quizScore = 0;
  document.getElementById('quiz-results-view').style.display = 'none';
  setupQuizInterface();
}

// Flashcard deck implementation
function setupFlashcardDeck() {
  document.getElementById('flashcards-section').style.display = 'block';
  renderFlashcard();
}

function renderFlashcard() {
  const card = state.quizFlashcards[state.currentFlashcardIdx];
  const cardElement = document.querySelector('.flashcard');
  
  cardElement.classList.remove('flipped');
  
  document.getElementById('fc-front-content').innerText = card.front;
  document.getElementById('fc-back-content').innerText = card.back;
  
  document.getElementById('flashcard-counter').innerText = `${state.currentFlashcardIdx + 1} of ${state.quizFlashcards.length}`;
}

function flipFlashcard(cardElement) {
  cardElement.classList.toggle('flipped');
}

function nextFlashcard() {
  if (state.quizFlashcards.length === 0) return;
  state.currentFlashcardIdx = (state.currentFlashcardIdx + 1) % state.quizFlashcards.length;
  renderFlashcard();
}

function prevFlashcard() {
  if (state.quizFlashcards.length === 0) return;
  state.currentFlashcardIdx = (state.currentFlashcardIdx - 1 + state.quizFlashcards.length) % state.quizFlashcards.length;
  renderFlashcard();
}


// 7. RAG: Document Upload & Context Question Answering

async function handleDocUpload(file) {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.pdf') && !lowerName.endsWith('.docx') && !lowerName.endsWith('.txt') &&
      !lowerName.endsWith('.png') && !lowerName.endsWith('.jpg') && !lowerName.endsWith('.jpeg')) {
    showToast('Supported document formats: PDF, DOCX, TXT, PNG, JPG, JPEG.', 'warning');
    return;
  }

  const spinner = document.getElementById('uploading-doc-spinner');
  spinner.style.display = 'block';

  const formData = new FormData();
  formData.append('document', file);

  try {
    const res = await fetch('/api/upload-document', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success) {
      state.uploadedDocuments.push({
        id: data.document_id,
        name: data.filename,
        chunks: data.chunk_count
      });
      
      renderUploadedDocumentsList();
      updateDashboardViews();
      selectActiveDocument(data.document_id, data.filename);
      showToast('Document uploaded and chunk-indexed!', 'success');
    } else {
      showToast('Upload failed: ' + (data.error || 'Server error'), 'danger');
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to connect to the server for document upload.', 'danger');
  } finally {
    spinner.style.display = 'none';
  }
}

function renderUploadedDocumentsList() {
  const container = document.getElementById('uploaded-docs-list');
  container.innerHTML = '';

  if (state.uploadedDocuments.length === 0) {
    container.innerHTML = '<div class="empty-docs-placeholder">No documents uploaded yet.</div>';
    return;
  }

  state.uploadedDocuments.forEach(doc => {
    const isChecked = state.activeDocumentIds.includes(doc.id);
    const item = document.createElement('div');
    item.className = `doc-list-item ${isChecked ? 'selected' : ''}`;
    item.onclick = (e) => {
      if (e.target.type === 'checkbox') return;
      toggleDocumentSelection(doc.id, doc.name);
    };

    item.innerHTML = `
      <div class="doc-info-wrapper" style="display:flex; align-items:center; gap: 8px;">
        <input type="checkbox" class="doc-select-checkbox" data-id="${doc.id}" ${isChecked ? 'checked' : ''} onchange="event.stopPropagation(); toggleDocumentSelection('${doc.id}', '${doc.name}')" style="accent-color: var(--accent-primary); cursor: pointer;" />
        <i data-lucide="file-text" style="color: ${isChecked ? 'var(--accent-primary)' : 'var(--text-secondary)'};"></i>
        <div class="doc-name" title="${doc.name}" style="font-weight: ${isChecked ? '600' : '400'}">${doc.name}</div>
      </div>
      <span class="doc-chunks">${doc.chunks} chunks</span>
    `;
    container.appendChild(item);
  });
  
  lucide.createIcons();
}

function toggleDocumentSelection(docId, docName) {
  const idx = state.activeDocumentIds.indexOf(docId);
  if (idx > -1) {
    state.activeDocumentIds.splice(idx, 1);
  } else {
    state.activeDocumentIds.push(docId);
  }

  renderUploadedDocumentsList();

  const titleEl = document.getElementById('active-document-title');
  const badge = document.getElementById('rag-badge');
  const chatInput = document.getElementById('doc-chat-input');
  const sendBtn = document.getElementById('doc-chat-send-btn');
  const micBtn = document.getElementById('doc-chat-mic-btn');

  if (state.activeDocumentIds.length > 0) {
    state.activeDocumentId = state.activeDocumentIds[state.activeDocumentIds.length - 1];
    state.activeDocumentName = docName;
    
    if (state.activeDocumentIds.length === 1) {
      titleEl.innerText = docName;
    } else {
      titleEl.innerText = `${state.activeDocumentIds.length} Files Selected`;
    }
    
    badge.className = 'rag-indicator status-enabled';
    badge.innerText = 'RAG Online';
    chatInput.disabled = false;
    sendBtn.disabled = false;
    if (micBtn) micBtn.disabled = false;
  } else {
    state.activeDocumentId = null;
    state.activeDocumentName = null;
    titleEl.innerText = 'No Document Selected';
    badge.className = 'rag-indicator status-disabled';
    badge.innerText = 'RAG Offline';
    chatInput.disabled = true;
    sendBtn.disabled = true;
    if (micBtn) micBtn.disabled = true;
  }

  const chatMessages = document.getElementById('doc-chat-messages');
  if (chatMessages.querySelector('.chat-placeholder')) {
    chatMessages.innerHTML = '';
  }
}

function selectActiveDocument(docId, docName) {
  state.activeDocumentIds = [];
  toggleDocumentSelection(docId, docName);
}

function appendDocChatMessage(role, text, sources = []) {
  const container = document.getElementById('doc-chat-messages');
  
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role === 'user' ? 'user-message' : 'model-message'}`;

  let htmlContent = '';
  if (role === 'user') {
    htmlContent = `<div class="message-content"><p>${text}</p>`;
  } else {
    htmlContent = `
      <div class="message-content">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 10px;">
          <p style="margin:0; flex: 1;">${text}</p>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="readBubbleText(this)" style="padding: 4px; border-radius: 6px; flex-shrink: 0;" title="Read aloud">
            <i data-lucide="volume-2"></i>
          </button>
        </div>
    `;
  }

  if (sources && sources.length > 0) {
    htmlContent += `
      <div class="sources-box">
        <h6>Referenced Context Passages:</h6>
    `;
    sources.forEach((src, index) => {
      htmlContent += `
        <div class="source-item">
          <strong>Excerpt ${index + 1}:</strong> ${src.substring(0, 180)}...
        </div>
      `;
    });
    htmlContent += `</div>`;
  }
  
  htmlContent += `</div>`;
  msgDiv.innerHTML = htmlContent;
  container.appendChild(msgDiv);
  
  container.scrollTop = container.scrollHeight;
  lucide.createIcons();
  return msgDiv;
}


// 8. AI Tutor Chatbot

async function sendTutorMessage(text) {
  const container = document.getElementById('chatbot-messages');
  
  const userDiv = document.createElement('div');
  userDiv.className = 'message user-message';
  userDiv.innerHTML = `<div class="message-content">${text}</div>`;
  container.appendChild(userDiv);
  container.scrollTop = container.scrollHeight;
  
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message model-message';
  loadingDiv.innerHTML = `<div class="message-content"><div class="spinner"></div></div>`;
  container.appendChild(loadingDiv);
  container.scrollTop = container.scrollHeight;

  state.chatbotHistory.push({ role: 'user', text: text });
  if (state.chatbotHistory.length > 12) {
    state.chatbotHistory.shift();
  }

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Groq-API-Key': sessionGetApiKey()
      },
      body: JSON.stringify({
        message: text,
        history: state.chatbotHistory
      })
    });
    const data = await res.json();
    
    loadingDiv.remove();

    if (res.ok && data.success) {
      const replyText = data.response;
      
      const modelDiv = document.createElement('div');
      modelDiv.className = 'message model-message';
      modelDiv.innerHTML = `
        <div class="message-content">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 10px;">
            <div style="flex: 1;">${marked.parse(replyText)}</div>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="readBubbleText(this)" style="padding: 4px; border-radius: 6px; flex-shrink: 0;" title="Read aloud">
              <i data-lucide="volume-2"></i>
            </button>
          </div>
        </div>
      `;
      container.appendChild(modelDiv);
      
      formatCodeBlocks(modelDiv);
      state.chatbotHistory.push({ role: 'model', text: replyText });
    } else {
      const errDiv = document.createElement('div');
      errDiv.className = 'message model-message';
      errDiv.innerHTML = `<div class="message-content" style="color:var(--danger)"><strong>Error:</strong> ${data.error || 'Unable to get response.'}</div>`;
      container.appendChild(errDiv);
    }
  } catch (err) {
    console.error(err);
    loadingDiv.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'message model-message';
    errDiv.innerHTML = `<div class="message-content" style="color:var(--danger)">Network error connecting to Tutor chatbot.</div>`;
    container.appendChild(errDiv);
  }
  
  container.scrollTop = container.scrollHeight;
  lucide.createIcons();
}

function sendQuickPrompt(promptText) {
  sendTutorMessage(promptText);
}

function clearChatHistory() {
  state.chatbotHistory = [];
  const container = document.getElementById('chatbot-messages');
  container.innerHTML = `
    <div class="message model-message">
      <div class="message-content">
        <p>Chat history cleared. What academic concepts or subjects are we reviewing now?</p>
      </div>
    </div>
  `;
}


// 9. Session Helpers
function sessionGetApiKey() {
  const input = document.getElementById('api-key-input');
  return input ? input.value : '';
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById('toggle-eye-icon');
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }
  lucide.createIcons();
}

// 10. SQLite persist loaders
async function loadUploadedDocuments() {
  try {
    const res = await fetch('/api/documents');
    const data = await res.json();
    if (data.success) {
      state.uploadedDocuments = data.documents;
      renderUploadedDocumentsList();
    }
  } catch (err) {
    console.error('Failed to load documents:', err);
  }
}

async function loadPinnedGoals() {
  try {
    const res = await fetch('/api/goals');
    const data = await res.json();
    if (data.success) {
      state.pinnedGoals = data.goals;
      updateDashboardViews();
    }
  } catch (err) {
    console.error('Failed to load goals:', err);
  }
}

// 11. Chart.js Radar helper
let skillsChartInstance = null;

function renderSkillsRadarChart(matched, missing) {
  const canvas = document.getElementById('ats-skills-chart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  if (skillsChartInstance) {
    skillsChartInstance.destroy();
  }
  
  const allLabels = [...matched.slice(0, 6), ...missing.slice(0, 6)];
  if (allLabels.length === 0) {
    allLabels.push("No Skills Detected");
  }
  
  const matchedData = allLabels.map(label => matched.includes(label) ? 100 : 0);
  const missingData = allLabels.map(label => missing.includes(label) ? 100 : 0);
  
  skillsChartInstance = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Matched Skills',
          data: matchedData,
          backgroundColor: 'rgba(6, 182, 212, 0.25)',
          borderColor: '#06b6d4',
          pointBackgroundColor: '#06b6d4',
          borderWidth: 2
        },
        {
          label: 'Missing Skills',
          data: missingData,
          backgroundColor: 'rgba(234, 179, 8, 0.25)',
          borderColor: '#eab308',
          pointBackgroundColor: '#eab308',
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
          angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
          pointLabels: {
            color: '#9ca3af',
            font: { family: 'Outfit', size: 10, weight: '500' }
          },
          ticks: { display: false, maxTicksLimit: 3 },
          suggestedMin: 0,
          suggestedMax: 100
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#f3f4f6',
            font: { family: 'Outfit', size: 11 }
          }
        }
      }
    }
  });
}

// 12. Voice Recognition STT & TTS
let activeRecognitionInstance = null;

window.toggleVoiceInput = function(inputId, button) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Voice typing is not supported in this browser. Please try Chrome/Edge.', 'warning');
    return;
  }
  
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;
  
  if (activeRecognitionInstance) {
    activeRecognitionInstance.stop();
    activeRecognitionInstance = null;
    button.classList.remove('pulse-mic');
    showToast('Voice input stopped.', 'info');
    return;
  }
  
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  
  recognition.onstart = () => {
    button.classList.add('pulse-mic');
    showToast('Listening... Speak now.', 'success');
  };
  
  recognition.onresult = (event) => {
    const speechResult = event.results[0][0].transcript;
    inputEl.value = (inputEl.value + ' ' + speechResult).trim();
  };
  
  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    showToast('Voice error: ' + event.error, 'danger');
    button.classList.remove('pulse-mic');
    activeRecognitionInstance = null;
  };
  
  recognition.onend = () => {
    button.classList.remove('pulse-mic');
    activeRecognitionInstance = null;
  };
  
  activeRecognitionInstance = recognition;
  recognition.start();
};

window.readBubbleText = function(button) {
  const messageEl = button.closest('.message');
  const contentEl = messageEl.querySelector('.message-content');
  if (!contentEl) return;
  
  const clone = contentEl.cloneNode(true);
  const btns = clone.querySelectorAll('button');
  btns.forEach(b => b.remove());
  const text = clone.innerText;
  
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    button.innerHTML = '<i data-lucide="volume-2"></i>';
    lucide.createIcons();
    showToast('Speech stopped.', 'info');
    return;
  }
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onend = () => {
    button.innerHTML = '<i data-lucide="volume-2"></i>';
    lucide.createIcons();
  };
  utterance.onerror = () => {
    button.innerHTML = '<i data-lucide="volume-2"></i>';
    lucide.createIcons();
  };
  
  button.innerHTML = '<i data-lucide="square"></i>';
  lucide.createIcons();
  window.speechSynthesis.speak(utterance);
  showToast('Speaking...', 'success');
};
