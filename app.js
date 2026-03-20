import { GeminiService } from './services/gemini.js';

// ============================================================
// CONSTANTS & SETTINGS
// ============================================================
const THEMES = {
  ao3: {
    '--bg-color': '#f5f0e8', '--surface-color': '#f9f7f4', '--surface-hover': '#ece6da',
    '--text-primary': '#2c2c2c', '--text-secondary': '#6a6558', '--accent-color': '#900000',
    '--accent-hover': '#b30000', '--border-color': '#c8b89a', '--error-color': '#cc0000',
    '--btn-text': '#ffffff', '--input-bg': '#ffffff',
    '--font-heading': "Georgia, 'Times New Roman', serif", '--font-body': 'Verdana, Arial, sans-serif',
  },
  modern: {
    '--bg-color': '#f7f8fa', '--surface-color': '#ffffff', '--surface-hover': '#f0f1f4',
    '--text-primary': '#1a1a1a', '--text-secondary': '#6b7280', '--accent-color': '#FF6122',
    '--accent-hover': '#e5531a', '--border-color': '#e5e7eb', '--error-color': '#ef4444',
    '--btn-text': '#ffffff', '--input-bg': '#f9fafb',
    '--font-heading': "'Inter', sans-serif", '--font-body': "'Inter', sans-serif",
  },
  ffn: {
    '--bg-color': '#dce8f4', '--surface-color': '#ffffff', '--surface-hover': '#ccd8e8',
    '--text-primary': '#1a2030', '--text-secondary': '#4a6080', '--accent-color': '#003d80',
    '--accent-hover': '#005cbf', '--border-color': '#9dbad4', '--error-color': '#c0392b',
    '--btn-text': '#ffffff', '--input-bg': '#f5f9ff',
    '--font-heading': 'Verdana, Arial, sans-serif', '--font-body': 'Verdana, Arial, sans-serif',
  }
};

const MODEL_OPTIONS = [
  // --- Newest Gemini 3 Series ---
  { value: 'gemini-3.1-pro-preview',     label: 'Gemini 3.1 Pro (Most Capable & Smartest)' },
  { value: 'gemini-3-deep-think',        label: 'Gemini 3 Deep Think (Advanced Reasoning)' },
  { value: 'gemini-3-flash-preview',     label: 'Gemini 3 Flash (New Default / Recommended)' },
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite (Fastest for Scale)' },

  // --- Gemini 2.5 Series (Stable/Standard) ---
  { value: 'gemini-2.5-pro',             label: 'Gemini 2.5 Pro (Stable Deep Reasoning)' },
  { value: 'gemini-2.5-flash',           label: 'Gemini 2.5 Flash (Balanced Speed/Quality)' },
  { value: 'gemini-2.5-flash-lite',      label: 'Gemini 2.5 Flash-Lite (High Efficiency)' },

  // --- Legacy / Deprecated ---
  { value: 'gemini-2.0-flash',           label: 'Gemini 2.0 Flash (Legacy - Shutdown June 2026)' },
  { value: 'gemini-1.5-pro',             label: 'Gemini 1.5 Pro (Legacy)' }
];

function defaultSettings() {
  return {
    theme: 'ao3', customColors: { ...THEMES.ao3 }, model: 'gemini-3-flash-preview',
    styleDirectives: ['onomatopoeia','sensory','internalThinks','paragraphVariety','characterAccuracy','dialogueHeavy','emotionalDepth','continuity'],
    promptLength: 'standard', povMode: 'thirdLimited', toneHints: ''
  };
}

let geminiClient = null;
let currentSessionId = null;
let sessions = [];
let pendingContextText = '';
let isEditingIntent = false;
let sidebarCollapsed = false;
let panelCollapsed = false;

// ============================================================
// STORAGE HELPERS
// ============================================================
const ls = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const ss = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const getApiKeys = () => ls('fpm_apikeys', []);
const getActiveKey = () => ls('fpm_apikeys', []).find(k => k.id === ls('fpm_active_key_id', null));
const setActiveKeyId = id => ss('fpm_active_key_id', id);

function rebuildGemini() {
  const key = getActiveKey();
  const set = ls('fpm_settings', defaultSettings());
  geminiClient = key ? new GeminiService(key.key, set.model) : null;
}

// Get a fresh GeminiService with a specific model (for regenerate)
function getGeminiWithModel(modelId) {
  const key = getActiveKey();
  if (!key) return null;
  return new GeminiService(key.key, modelId);
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================
// status: 'intent' | 'generating_qs' | 'qa' | 'generating_prompt' | 'done'
function createSession() {
  const s = {
    id: `sess_${Date.now()}`,
    name: `Chat ${sessions.length + 1}`,
    pinned: false,
    updatedAt: Date.now(),
    status: 'intent',
    intent: '', contextFileName: '', contextText: '',
    questions: [], qaAnswers: [],
    // NEW: promptHistory stores each generation { prompt, model, createdAt }
    promptHistory: [],
    finalPrompt: '' // kept for backwards compatibility
  };
  sessions.unshift(s);
  saveSessions();
  return s.id;
}

function loadSessions() {
  sessions = ls('fpm_sessions', []);
  // Migrate old sessions to include promptHistory
  sessions.forEach(s => {
    if (!s.promptHistory) {
      s.promptHistory = s.finalPrompt ? [{ prompt: s.finalPrompt, model: 'unknown', createdAt: s.updatedAt }] : [];
    }
  });
  currentSessionId = ls('fpm_active_sess', null);
  if (sessions.length === 0) currentSessionId = createSession();
  if (!sessions.find(s => s.id === currentSessionId)) currentSessionId = sessions[0].id;
}

function saveSessions() {
  sessions.sort((a,b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
  ss('fpm_sessions', sessions);
  ss('fpm_active_sess', currentSessionId);
}

function getActiveSession() { return sessions.find(s => s.id === currentSessionId); }

function switchSession(id) {
  currentSessionId = id;
  isEditingIntent = false;
  pendingContextText = '';
  document.getElementById('fileInput').value = '';
  document.getElementById('attachmentBar').style.display = 'none';
  closePromptPanel();
  saveSessions();
  renderSidebar();
  renderChat();

  if (window.innerWidth <= 768) {
    sidebarCollapsed = true;
    document.querySelector('.sidebar').classList.add('collapsed');
  }
}

function deleteSession(id) {
  sessions = sessions.filter(s => s.id !== id);
  if (sessions.length === 0) createSession();
  if (currentSessionId === id) currentSessionId = sessions[0].id;
  saveSessions();
  renderSidebar();
  renderChat();
}

// ============================================================
// SIDEBAR RENDERER
// ============================================================
function renderSidebar() {
  const pinnedList = document.getElementById('pinnedSessionsList');
  const recentList = document.getElementById('recentSessionsList');
  pinnedList.innerHTML = ''; recentList.innerHTML = '';

  sessions.forEach(sess => {
    const el = document.createElement('div');
    el.className = `session-item ${sess.id === currentSessionId ? 'active' : ''}`;
    
    // Show a small badge if session has prompts
    const promptBadge = sess.promptHistory?.length > 0
      ? `<span class="prompt-count-badge">${sess.promptHistory.length}</span>`
      : '';
    
    el.innerHTML = `
      <div class="session-name" title="${escHtml(sess.name)}">${escHtml(sess.name)}${promptBadge}</div>
      <div class="session-actions">
        <button class="icon-btn btn-pin" title="Pin / Unpin">${sess.pinned ? '📌' : '📍'}</button>
        <button class="icon-btn btn-del" title="Delete">✕</button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      switchSession(sess.id);
    });

    el.querySelector('.btn-pin').addEventListener('click', () => {
      sess.pinned = !sess.pinned;
      sess.updatedAt = Date.now();
      saveSessions();
      renderSidebar();
    });

    el.querySelector('.btn-del').addEventListener('click', () => {
      if(confirm(`Delete "${sess.name}" forever?`)) deleteSession(sess.id);
    });

    if (sess.pinned) pinnedList.appendChild(el);
    else recentList.appendChild(el);
  });
}

// ============================================================
// PROMPT RESULT PANEL (bottom drawer)
// ============================================================
let currentPromptIndex = 0; // which generation is currently shown in the panel

function emptyPromptPanel() {
  const panel = document.getElementById('promptResultPanel');
  if(!panel) return;
  panel.querySelector('.prompt-panel-header').innerHTML = `
    <div class="prompt-panel-title">
      <span>✨ Generated Prompt</span>
    </div>
    <div class="panel-chevron" style="transition: transform 0.3s; transform: rotate(${panelCollapsed ? 180 : 0}deg);">▼</div>
  `;
  panel.querySelector('.prompt-panel-body').innerHTML = `
    <div style="color: var(--text-secondary); font-style: italic; display: flex; align-items: center; justify-content: center; height: 100%; font-family: var(--font-body);">
      Waiting for prompt generation...
    </div>
  `;
  panel.querySelector('.prompt-panel-footer').innerHTML = '';
}

function generatingPromptPanel() {
  const panel = document.getElementById('promptResultPanel');
  if(!panel) return;
  panel.querySelector('.prompt-panel-header').innerHTML = `
    <div class="prompt-panel-title">
      <span>✨ Generated Prompt</span>
    </div>
    <div class="panel-chevron" style="transition: transform 0.3s; transform: rotate(${panelCollapsed ? 180 : 0}deg);">▼</div>
  `;
  panel.querySelector('.prompt-panel-body').innerHTML = `
    <div class="generating-indicator" style="justify-content: center; height: 100%;">
      <div class="gen-spinner"></div>
      <span>Generating your Master Prompt…</span>
    </div>
  `;
  panel.querySelector('.prompt-panel-footer').innerHTML = '';
}

function openPromptPanel(sessionId, idx) {
  const s = sessions.find(s => s.id === sessionId);
  if (!s) return;

  if (s.status === 'generating_prompt') {
    generatingPromptPanel();
    return;
  }

  if (!s.promptHistory || !s.promptHistory.length) {
    emptyPromptPanel();
    return;
  }

  currentPromptIndex = idx !== undefined ? idx : (s.promptHistory.length - 1);
  renderPromptPanel(s);
}

function closePromptPanel() {
  // No-op now since it's always open
}

function renderPromptPanel(s) {
  const panel = document.getElementById('promptResultPanel');
  if (!panel || !s.promptHistory.length) return;

  const entry = s.promptHistory[currentPromptIndex];
  const total = s.promptHistory.length;
  const isLatest = currentPromptIndex === total - 1;
  const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
  
  // Build model options for the regenerate picker
  const modelOptsHtml = MODEL_OPTIONS.map(m =>
    `<option value="${m.value}" ${m.value === (ls('fpm_settings', defaultSettings()).model) ? 'selected' : ''}>${m.label}</option>`
  ).join('');

  panel.querySelector('.prompt-panel-header').innerHTML = `
    <div class="prompt-panel-title">
      <span>✨ Generated Prompt</span>
      <span class="prompt-entry-meta">
        ${total > 1 ? `<button class="icon-btn pp-nav" id="ppNavPrev" title="Previous" ${currentPromptIndex === 0 ? 'disabled' : ''}>◀</button>` : ''}
        <span class="pp-counter">${total > 1 ? `${currentPromptIndex + 1} / ${total}` : ''}</span>
        ${total > 1 ? `<button class="icon-btn pp-nav" id="ppNavNext" title="Next" ${currentPromptIndex === total-1 ? 'disabled' : ''}>▶</button>` : ''}
        <span class="pp-model-tag">${escHtml(entry.model || 'unknown model')}</span>
        ${date ? `<span class="pp-date">${date}</span>` : ''}
      </span>
    </div>
    <div class="panel-chevron" style="transition: transform 0.3s; transform: rotate(${panelCollapsed ? 180 : 0}deg);">▼</div>
  `;
  panel.querySelector('.prompt-panel-body').textContent = entry.prompt;
  
  panel.querySelector('.prompt-panel-footer').innerHTML = `
    <div class="regen-row">
      <select id="regenModelSelect" title="Choose model for regeneration">
        ${modelOptsHtml}
      </select>
      <button id="btnRegenerate" class="regen-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        Regenerate
      </button>
    </div>
    <div class="panel-copy-actions">
      <button id="btnCopyPromptPanel">📋 Copy Prompt</button>
      <button class="secondary" id="btnNewChatPanel">Start New Chat</button>
    </div>
  `;

  // Bind events
  document.getElementById('btnCopyPromptPanel').addEventListener('click', (e) => {
    navigator.clipboard.writeText(entry.prompt).then(() => {
      e.target.textContent = '✅ Copied!';
      setTimeout(() => e.target.textContent = '📋 Copy Prompt', 2000);
    });
  });
  document.getElementById('btnNewChatPanel').addEventListener('click', () => {
    switchSession(createSession());
  });

  const prevBtn = document.getElementById('ppNavPrev');
  const nextBtn = document.getElementById('ppNavNext');
  if (prevBtn) prevBtn.addEventListener('click', () => { currentPromptIndex--; renderPromptPanel(s); });
  if (nextBtn) nextBtn.addEventListener('click', () => { currentPromptIndex++; renderPromptPanel(s); });

  document.getElementById('btnRegenerate').addEventListener('click', () => {
    const modelId = document.getElementById('regenModelSelect').value;
    regeneratePrompt(s.id, modelId);
  });
}

async function regeneratePrompt(sessionId, modelId) {
  const s = sessions.find(s => s.id === sessionId);
  if (!s) return;

  const client = getGeminiWithModel(modelId);
  if (!client) {
    alert('No active API key. Please add one in Settings.');
    return;
  }

  // Show loading state in the panel
  const panel = document.getElementById('promptResultPanel');
  const body = panel.querySelector('.prompt-panel-body');
  const footer = panel.querySelector('.prompt-panel-footer');
  body.innerHTML = `<div class="generating-indicator"><div class="gen-spinner"></div><span>Regenerating prompt with <b>${escHtml(modelId)}</b>…</span></div>`;
  footer.innerHTML = '';

  try {
    const set = ls('fpm_settings', defaultSettings());
    const raw = await client.generateMasterPrompt(s.intent, s.contextText, s.qaAnswers, set);
    const conf = `\n\n---\nBefore you begin writing, please read everything above carefully. Confirm that you understand the characters, their voices, the scenario, and the intended tone. If anything is unclear or you have questions, ask now. Once you are ready, let me know and we will begin.`;
    const newPrompt = raw.trim() + conf;

    s.promptHistory.push({ prompt: newPrompt, model: modelId, createdAt: Date.now() });
    s.finalPrompt = newPrompt;
    s.updatedAt = Date.now();
    currentPromptIndex = s.promptHistory.length - 1;

    saveSessions();
    renderSidebar();
    renderChat();
    renderPromptPanel(s);
  } catch (e) {
    body.innerHTML = `<div class="error-message" style="display:block;">Regeneration failed: ${escHtml(e.message)}</div>`;
    setTimeout(() => renderPromptPanel(s), 3000);
  }
}

// ============================================================
// CHAT RENDERER
// ============================================================
function renderChat() {
  const s = getActiveSession();
  if (!s) return;

  // Sync bottom panel
  openPromptPanel(s.id);

  const titleInput = document.getElementById('sessionNameInput');
  titleInput.value = s.name;

  const pinBtn = document.getElementById('btnTogglePin');
  if (s.pinned) pinBtn.classList.add('is-pinned');
  else pinBtn.classList.remove('is-pinned');

  const history = document.getElementById('chatHistory');
  const dock = document.getElementById('chatDock');
  const attachBar = document.getElementById('attachmentBar');

  history.innerHTML = '';
  dock.style.display = 'none';
  document.getElementById('editModeIndicator').style.display = 'none';

  const addSys = (html) => {
    const w = document.createElement('div'); w.className = 'bubble-wrapper ai';
    w.innerHTML = `<div class="bubble ai">${html}</div>`;
    history.appendChild(w);
  };
  const addUser = (text, fileHtml = '') => {
    const w = document.createElement('div'); w.className = 'bubble-wrapper user';
    w.innerHTML = `<div class="bubble user">${fileHtml}${escHtml(text)}</div>`;
    history.appendChild(w);
  };

  // 1. Greeting
  addSys('<b>Welcome!</b><br>Describe the fanfic you want to write. You can also attach a lore or reference file (PDF, DOCX, TXT).');

  // Edit Intent Mode
  if (isEditingIntent) {
    document.getElementById('intentInput').value = s.intent;
    if (pendingContextText || s.contextText) {
      document.getElementById('attachedFileName').textContent = pendingContextText ? "New file attached" : s.contextFileName;
      attachBar.style.display = 'flex';
    } else {
      attachBar.style.display = 'none';
    }
    dock.style.display = 'block';
    document.getElementById('editModeIndicator').style.display = 'block';
    setTimeout(() => history.scrollTo(0, history.scrollHeight), 50);
    return;
  }

  // Empty state
  if (s.status === 'intent') {
    document.getElementById('intentInput').value = '';
    dock.style.display = 'block';
    setTimeout(() => history.scrollTo(0, history.scrollHeight), 50);
    return;
  }

  // 2. Submitted Intent
  const fileHtml = s.contextFileName ? `<div class="file-badge">📎 ${escHtml(s.contextFileName)}</div>` : '';
  addUser(s.intent, fileHtml);

  if (s.status !== 'generating_qs') {
    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'align-self:flex-end; margin-top:-1rem;';
    btnWrap.innerHTML = `<button class="icon-btn edit-intent-btn" id="btnEditIntent">✏️ Edit Idea</button>`;
    btnWrap.querySelector('button').addEventListener('click', () => { isEditingIntent = true; renderChat(); });
    history.appendChild(btnWrap);
  }

  // 3. Generating Questions
  if (s.status === 'generating_qs') {
    addSys('<div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div> Reading premise…</div>');
    scrollToBottom(); return;
  }

  // 4. Q&A History
  s.qaAnswers.forEach((ans, i) => {
    addSys(`<b>Question ${i+1}:</b>\n${escHtml(ans.question)}`);
    addUser(ans.answer);
  });

  // 5. Active Question
  if (s.status === 'qa') {
    const currIdx = s.qaAnswers.length;
    const qData = s.questions[currIdx];

    const w = document.createElement('div'); w.className = 'bubble-wrapper ai';
    let html = `<div class="bubble ai" style="width:100%; max-width:500px;">`;
    html += `<b>Question ${currIdx+1} of 5:</b>\n${escHtml(qData.question)}\n\n<div class="qa-options">`;
    qData.options.forEach(opt => {
      html += `<button class="qa-btn" data-val="${escAttr(opt)}">${escHtml(opt)}</button>`;
    });
    html += `<button class="qa-btn" id="btnCustomAnsToggle">✏️ Write my own answer…</button>`;
    html += `<div class="custom-ans-wrapper hidden" id="customAnsWrap">
               <input type="text" id="customAnsInput" placeholder="Type answer…">
               <button class="danger" id="btnSubmitCustom">Send</button>
             </div>`;
    html += `</div></div>`;
    w.innerHTML = html;
    history.appendChild(w);

    w.querySelectorAll('.qa-btn[data-val]').forEach(b => {
      b.addEventListener('click', () => submitAnswer(b.getAttribute('data-val')));
    });
    w.querySelector('#btnCustomAnsToggle').addEventListener('click', (e) => {
      e.target.style.display = 'none';
      w.querySelector('#customAnsWrap').classList.remove('hidden');
      w.querySelector('#customAnsInput').focus();
    });
    w.querySelector('#btnSubmitCustom').addEventListener('click', () => {
      const val = w.querySelector('#customAnsInput').value.trim();
      if(val) submitAnswer(val);
    });
    w.querySelector('#customAnsInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const val = w.querySelector('#customAnsInput').value.trim(); if(val) submitAnswer(val); }
    });

    scrollToBottom(); return;
  }

  // 6. Generating Prompt — enhanced loading state
  if (s.status === 'generating_prompt') {
    const w = document.createElement('div'); w.className = 'bubble-wrapper ai';
    w.innerHTML = `
      <div class="bubble ai generating-prompt-bubble">
        <div class="gen-spinner-row">
          <div class="gen-spinner"></div>
          <span>Generating your Master Prompt…</span>
        </div>
        <div class="gen-steps">
          <div class="gen-step active">📖 Analysing your story idea</div>
          <div class="gen-step">🎭 Crafting character voices</div>
          <div class="gen-step">✍️ Building the scene structure</div>
          <div class="gen-step">✨ Finalising the prompt</div>
        </div>
      </div>`;
    history.appendChild(w);

    // Animate the steps sequentially
    const steps = w.querySelectorAll('.gen-step');
    steps.forEach((step, i) => {
      setTimeout(() => {
        steps.forEach(s => s.classList.remove('active'));
        step.classList.add('active');
      }, i * 1800);
    });

    scrollToBottom(); return;
  }

  // 7. Done — show chat history of all prompts + panel trigger
  if (s.status === 'done') {
    // Show each generation in chat history
    s.promptHistory.forEach((entry, idx) => {
      const w = document.createElement('div'); w.className = 'bubble-wrapper ai';
      const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
      const isLatest = idx === s.promptHistory.length - 1;

      w.innerHTML = `
        <div class="prompt-chat-card ${isLatest ? 'latest' : ''}">
          <div class="prompt-chat-card-header">
            <span class="pcc-label">${isLatest ? '✨ Latest Prompt' : `📝 Prompt #${idx + 1}`}</span>
            <div class="pcc-meta">
              <span class="pp-model-tag">${escHtml(entry.model || 'unknown')}</span>
              ${date ? `<span class="pp-date">${date}</span>` : ''}
            </div>
          </div>
          <div class="prompt-chat-preview">${escHtml(entry.prompt.slice(0, 220))}${entry.prompt.length > 220 ? '…' : ''}</div>
          <button class="view-prompt-btn" data-idx="${idx}">View Full Prompt</button>
        </div>`;
      history.appendChild(w);

      w.querySelector('.view-prompt-btn').addEventListener('click', () => {
        openPromptPanel(s.id, idx);
      });
    });

    // Actions row
    const actionWrap = document.createElement('div');
    actionWrap.className = 'bubble-wrapper ai';
    actionWrap.innerHTML = `
      <div class="prompt-done-actions">
        <button id="btnOpenLastPrompt" class="open-prompt-btn">✨ View Latest Prompt</button>
        <button class="secondary" id="btnNewChatFromDone">Start New Chat</button>
      </div>`;
    history.appendChild(actionWrap);
    actionWrap.querySelector('#btnOpenLastPrompt').addEventListener('click', () => {
      openPromptPanel(s.id, s.promptHistory.length - 1);
    });
    actionWrap.querySelector('#btnNewChatFromDone').addEventListener('click', () => {
      switchSession(createSession());
    });

    scrollToBottom();


  }
}

function scrollToBottom() {
  const h = document.getElementById('chatHistory');
  setTimeout(() => h.scrollTo({top: h.scrollHeight, behavior: 'smooth'}), 80);
}

// ============================================================
// CHAT FLOW ACTIONS (GEMINI CALLS)
// ============================================================
async function flushIntent() {
  if (!geminiClient) {
    alert('No active API key. Please add one in Settings.');
    return;
  }

  const intentInput = document.getElementById('intentInput');
  const txt = intentInput.value.trim();

  if (!txt) {
    const err = document.getElementById('dockError');
    err.textContent = "Please describe the idea first.";
    err.style.display = 'block';
    setTimeout(() => err.style.display='none', 3000);
    return;
  }

  const s = getActiveSession();
  s.intent = txt;

  if (pendingContextText) {
    s.contextText = pendingContextText;
    s.contextFileName = document.getElementById('fileInput').files[0]?.name || "Attached File";
  } else if (!isEditingIntent) {
    s.contextText = ''; s.contextFileName = '';
  }

  s.status = 'generating_qs';
  s.questions = []; s.qaAnswers = [];
  s.promptHistory = []; s.finalPrompt = '';
  s.updatedAt = Date.now();
  if (s.name.startsWith('Chat ')) s.name = txt.slice(0, 28) + (txt.length > 28 ? '…' : '');

  isEditingIntent = false;
  pendingContextText = '';
  closePromptPanel();
  saveSessions(); renderSidebar(); renderChat();

  try {
    const qs = await geminiClient.generateQuestions(s.intent, s.contextText);
    const sUpdated = getActiveSession();
    if (sUpdated.id !== s.id || sUpdated.status !== 'generating_qs') return;

    sUpdated.questions = qs;
    sUpdated.status = 'qa';
    sUpdated.updatedAt = Date.now();
    saveSessions(); renderChat();
  } catch (e) {
    s.status = 'intent';
    isEditingIntent = true;
    saveSessions(); renderChat();
    alert("Generation failed: " + e.message);
  }
}

async function submitAnswer(ansText) {
  const s = getActiveSession();
  if (s.status !== 'qa') return;

  const currQ = s.questions[s.qaAnswers.length];
  s.qaAnswers.push({ question: currQ.question, answer: ansText });
  s.updatedAt = Date.now();

  if (s.qaAnswers.length >= s.questions.length) {
    s.status = 'generating_prompt';
    saveSessions(); renderChat();

    try {
      // Always use the latest settings model
      rebuildGemini();
      const client = geminiClient;
      if (!client) throw new Error('No active API key.');

      const set = ls('fpm_settings', defaultSettings());
      const raw = await client.generateMasterPrompt(s.intent, s.contextText, s.qaAnswers, set);
      const conf = `\n\n---\nBefore you begin writing, please read everything above carefully. Confirm that you understand the characters, their voices, the scenario, and the intended tone. If anything is unclear or you have questions, ask now. Once you are ready, let me know and we will begin.`;
      const newPrompt = raw.trim() + conf;

      const sUpdated = getActiveSession();
      if (sUpdated.id !== s.id) return;

      const modelUsed = set.model;
      sUpdated.promptHistory.push({ prompt: newPrompt, model: modelUsed, createdAt: Date.now() });
      sUpdated.finalPrompt = newPrompt;
      sUpdated.status = 'done';
      sUpdated.updatedAt = Date.now();
      saveSessions(); renderSidebar(); renderChat();

    } catch (e) {
      s.status = 'qa';
      s.qaAnswers.pop();
      saveSessions(); renderChat();
      alert("Failed to build prompt: " + e.message);
    }
  } else {
    saveSessions(); renderChat();
  }
}

// ============================================================
// SETTINGS SYNC
// ============================================================
function applyTheme(themeName) {
  const map = THEMES[themeName];
  if(!map) return;
  for (const [k,v] of Object.entries(map)) document.documentElement.style.setProperty(k, v);
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === themeName));
}

function syncSettingsUI() {
  const s = ls('fpm_settings', defaultSettings());
  applyTheme(s.theme);
  for (const [k,v] of Object.entries(s.customColors)) document.documentElement.style.setProperty(k, v);

  document.querySelectorAll('input[type="color"][data-var]').forEach(i => {
    let col = s.customColors[i.dataset.var];
    if (col && col.startsWith('#') && col.length === 4) col = '#'+col[1]+col[1]+col[2]+col[2]+col[3]+col[3];
    i.value = col?.substring(0,7) || '#000000';
  });

  const modelEl = document.getElementById('modelSelect'); if(modelEl) modelEl.value = s.model;
  document.querySelectorAll('input[name="styleDirective"]').forEach(cb => cb.checked = s.styleDirectives.includes(cb.value));
  const lenEl = document.querySelector(`input[name="promptLength"][value="${s.promptLength}"]`); if(lenEl) lenEl.checked = true;
  const povEl = document.querySelector(`input[name="povMode"][value="${s.povMode}"]`); if(povEl) povEl.checked = true;
  document.getElementById('toneHintsInput').value = s.toneHints || '';
}

function readSettingsUI() {
  const s = ls('fpm_settings', defaultSettings());
  s.model = document.getElementById('modelSelect')?.value || 'gemini-3-flash-preview';
  s.toneHints = document.getElementById('toneHintsInput').value.trim();
  s.styleDirectives = Array.from(document.querySelectorAll('input[name="styleDirective"]:checked')).map(c=>c.value);
  s.promptLength = document.querySelector('input[name="promptLength"]:checked')?.value || 'standard';
  s.povMode = document.querySelector('input[name="povMode"]:checked')?.value || 'thirdLimited';
  return s;
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function bindEvents() {
  // Sidebar
  document.getElementById('btnNewSession').addEventListener('click', () => switchSession(createSession()));
  document.getElementById('sessionNameInput').addEventListener('change', (e) => {
    const s = getActiveSession(); if(s && e.target.value.trim()) { s.name = e.target.value.trim(); saveSessions(); renderSidebar(); }
  });
  document.getElementById('btnTogglePin').addEventListener('click', () => {
    const s = getActiveSession(); if(s) { s.pinned = !s.pinned; saveSessions(); renderSidebar(); renderChat(); }
  });

  document.getElementById('btnToggleSidebar').addEventListener('click', () => {
    sidebarCollapsed = !sidebarCollapsed;
    document.querySelector('.sidebar').classList.toggle('collapsed', sidebarCollapsed);
  });

  const btnCollapseSidebar = document.getElementById('btnCollapseSidebar');
  if (btnCollapseSidebar) {
    btnCollapseSidebar.addEventListener('click', () => {
      sidebarCollapsed = true;
      document.querySelector('.sidebar').classList.add('collapsed');
    });
  }

  document.getElementById('promptResultPanel').addEventListener('click', (e) => {
    if (e.target.closest('.prompt-panel-header')) {
      panelCollapsed = !panelCollapsed;
      document.getElementById('promptResultPanel').classList.toggle('collapsed', panelCollapsed);
      const chevron = document.querySelector('.panel-chevron');
      if (chevron) {
        chevron.style.transform = `rotate(${panelCollapsed ? 180 : 0}deg)`;
      }
    }
  });

  // Dock
  const intentInput = document.getElementById('intentInput');
  document.getElementById('btnSendIntent').addEventListener('click', flushIntent);
  intentInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); flushIntent(); }
  });

  // Auto-resize textarea
  intentInput.addEventListener('input', () => {
    intentInput.style.height = 'auto';
    intentInput.style.height = Math.min(intentInput.scrollHeight, 200) + 'px';
  });

  // File
  const fileIn = document.getElementById('fileInput');
  document.getElementById('btnAttach').addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if(!f) return;
    document.getElementById('attachedFileName').textContent = '📎 ' + f.name;
    document.getElementById('attachmentBar').style.display = 'flex';
    try { pendingContextText = await f.text(); } catch { pendingContextText = "[Context File Uploaded]"; }
  });
  document.getElementById('btnRemoveAttachment').addEventListener('click', () => {
    fileIn.value = ''; pendingContextText = '';
    document.getElementById('attachmentBar').style.display = 'none';
  });

  // API Keys
  const rdrKeys = () => {
    const keys = getApiKeys(); const actId = ls('fpm_active_key_id', null);
    const lst = document.getElementById('apiKeyManagerList');
    lst.innerHTML = keys.length ? keys.map(k=>`<div class="api-key-item ${k.id===actId?'active-key':''}">
      <span class="key-name">${escHtml(k.name)}</span><span class="key-value">${k.key.slice(0,6)}…</span>
      ${k.id===actId? '<b>Active</b>':`<button class="small" onclick="window._useK('${k.id}')">Use</button>`}
      <button class="danger" onclick="window._delK('${k.id}')">✕</button></div>`).join('') : 'No keys saved.';
  };
  window._useK = (id) => { setActiveKeyId(id); rebuildGemini(); rdrKeys(); };
  window._delK = (id) => {
    let ks=getApiKeys().filter(k=>k.id!==id); ss('fpm_apikeys',ks);
    if(ls('fpm_active_key_id')===id) { setActiveKeyId(ks[0]?.id||null); rebuildGemini(); } rdrKeys();
  };
  document.getElementById('btnShowAddKeyForm').addEventListener('click', () => document.getElementById('addKeyForm').classList.toggle('active'));
  document.getElementById('btnCancelAddKey').addEventListener('click', () => document.getElementById('addKeyForm').classList.remove('active'));
  document.getElementById('btnSaveNewKey').addEventListener('click', () => {
    const n = document.getElementById('addKeyName').value.trim()||`Key`;
    const v = document.getElementById('addKeyValue').value.trim(); if(!v) return;
    const ks = getApiKeys(); const id = 'k_'+Date.now();
    ks.push({id, name:n, key:v}); ss('fpm_apikeys', ks);
    if (!getActiveKey()) { setActiveKeyId(id); rebuildGemini(); }
    document.getElementById('addKeyForm').classList.remove('active'); rdrKeys();
  });

  // Initial overlay
  document.getElementById('btnUseSavedKey').addEventListener('click', () => {
    setActiveKeyId(document.getElementById('selectSavedKey').value);
    rebuildGemini(); document.getElementById('apiKeyOverlay').classList.remove('active');
  });
  document.getElementById('btnSaveApiKey').addEventListener('click', () => {
    const v = document.getElementById('newApiKeyInput').value.trim();
    if(!v) return;
    const n = document.getElementById('newApiKeyName').value.trim() || 'My Key';
    const ks = getApiKeys(); const id='k_'+Date.now(); ks.push({id,name:n,key:v}); ss('fpm_apikeys',ks);
    setActiveKeyId(id); rebuildGemini();
    document.getElementById('apiKeyOverlay').classList.remove('active');
  });

  // Settings
  const sOl = document.getElementById('settingsOverlay');
  document.getElementById('btnOpenSettings').addEventListener('click', () => { rdrKeys(); sOl.classList.add('active'); });
  document.getElementById('btnSettingsClose').addEventListener('click', () => {
    const s = readSettingsUI(); ss('fpm_settings', s); rebuildGemini(); sOl.classList.remove('active');
  });

  // Themes
  document.querySelectorAll('.theme-card').forEach(c => c.addEventListener('click', () => {
    const tn = c.dataset.theme; const s = ls('fpm_settings', defaultSettings());
    s.theme = tn; s.customColors = { ...THEMES[tn] }; ss('fpm_settings', s); syncSettingsUI();
  }));

  // Colors
  document.querySelectorAll('input[type="color"][data-var]').forEach(p => {
    p.addEventListener('input', () => {
      const v = p.dataset.var; const val = p.value;
      document.documentElement.style.setProperty(v, val);
      if (v === '--accent-color') document.documentElement.style.setProperty('--accent-hover', val);
      const s = ls('fpm_settings', defaultSettings());
      s.theme = 'custom'; s.customColors[v] = val; ss('fpm_settings', s);
      document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
    });
  });

  // Reset
  document.getElementById('btnResetSettings').addEventListener('click', () => {
    ss('fpm_settings', defaultSettings()); syncSettingsUI(); rebuildGemini();
  });


}

// Utils
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s){ return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

// ============================================================
// BOOTSTRAP
// ============================================================
function init() {
  syncSettingsUI();
  loadSessions();
  bindEvents();

  const keys = getApiKeys();
  if (keys.length) {
    const d = document.getElementById('savedKeysBlock'); d.style.display = 'block';
    const s = document.getElementById('selectSavedKey');
    const act = getActiveKey();
    s.innerHTML = keys.map(k => `<option value="${k.id}" ${act?.id===k.id?'selected':''}>${escHtml(k.name)}</option>`).join('');
  }

  if (getActiveKey()) {
    rebuildGemini();
    document.getElementById('apiKeyOverlay').classList.remove('active');
  }

  renderSidebar();
  renderChat();
}

init();
