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

function defaultSettings() {
  return {
    theme: 'ao3', customColors: { ...THEMES.ao3 }, model: 'gemini-2.5-flash',
    styleDirectives: ['onomatopoeia','sensory','internalThinks','paragraphVariety','characterAccuracy','dialogueHeavy','emotionalDepth','continuity'],
    promptLength: 'standard', povMode: 'thirdLimited', toneHints: ''
  };
}

let geminiClient = null;
let currentSessionId = null; 
let sessions = []; // array of session objects
let pendingContextText = '';
let isEditingIntent = false;

// ============================================================
// STORAGE HELPERS (API KEYS & SETTINGS)
// ============================================================
const ls = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } };
const ss = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const getApiKeys = () => ls('fpm_apikeys', []);
const getActiveKey = () => ls('fpm_apikeys', []).find(k => k.id === ls('fpm_active_key_id', null));
const setActiveKeyId = id => ss('fpm_active_key_id', id);

function rebuildGemini() {
  const key = getActiveKey();
  const set = ls('fpm_settings', defaultSettings());
  geminiClient = key ? new GeminiService(key.key, set.model) : null;
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
    questions: [], qaAnswers: [], finalPrompt: ''
  };
  sessions.unshift(s);
  saveSessions();
  return s.id;
}

function loadSessions() {
  sessions = ls('fpm_sessions', []);
  currentSessionId = ls('fpm_active_sess', null);
  if (sessions.length === 0) currentSessionId = createSession();
  if (!sessions.find(s => s.id === currentSessionId)) currentSessionId = sessions[0].id;
}

function saveSessions() {
  sessions.sort((a,b) => b.updatedAt - a.updatedAt);
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
  saveSessions();
  renderSidebar();
  renderChat();
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
    el.innerHTML = `
      <div class="session-name" title="${escHtml(sess.name)}">${escHtml(sess.name)}</div>
      <div class="session-actions">
        <button class="icon-btn btn-pin" title="Pin / Unpin">${sess.pinned ? '📌' : '📍'}</button>
        <button class="icon-btn btn-del" title="Delete">🗑️</button>
      </div>
    `;
    
    // Switch on click
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // ignore action clicks
      switchSession(sess.id);
    });

    // Pin Action
    el.querySelector('.btn-pin').addEventListener('click', () => {
      sess.pinned = !sess.pinned;
      sess.updatedAt = Date.now();
      saveSessions();
      renderSidebar();
      renderChat();
    });

    // Del Action
    el.querySelector('.btn-del').addEventListener('click', () => {
      if(confirm(`Delete "${sess.name}" forever?`)) deleteSession(sess.id);
    });

    if (sess.pinned) pinnedList.appendChild(el);
    else recentList.appendChild(el);
  });
}

// ============================================================
// CHAT RENDERER
// ============================================================
function renderChat() {
  const s = getActiveSession();
  if (!s) return;

  // Header Title
  const titleInput = document.getElementById('sessionNameInput');
  titleInput.value = s.name;
  
  const pinBtn = document.getElementById('btnTogglePin');
  if (s.pinned) pinBtn.classList.add('is-pinned');
  else pinBtn.classList.remove('is-pinned');

  const history = document.getElementById('chatHistory');
  const dock = document.getElementById('chatDock');
  const attachBar = document.getElementById('attachmentBar');
  
  history.innerHTML = ''; // Clear
  dock.style.display = 'none';
  document.getElementById('editModeIndicator').style.display = 'none';

  // HELPER: Append Bubbles
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

  // 1. Initial Greeting
  addSys('<b>Welcome!</b><br>To begin, describe the fanfic you want to write or edit your idea in the dock below. You can also attach a lore or reference file (PDF, DOCX, TXT).');

  // Handle Edit Intent Mode
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

  // Handle Empty State (Ready for Intent)
  if (s.status === 'intent') {
    document.getElementById('intentInput').value = ''; 
    dock.style.display = 'block';
    setTimeout(() => history.scrollTo(0, history.scrollHeight), 50);
    return;
  }

  // 2. Render Submitted Intent
  const fileHtml = s.contextFileName ? `<div class="file-badge">📎 ${escHtml(s.contextFileName)}</div>` : '';
  addUser(s.intent, fileHtml);

  // Intent Actions
  if (s.status !== 'generating_qs') {
    const btnWrap = document.createElement('div'); btnWrap.style.alignSelf = 'flex-end'; btnWrap.style.marginTop = '-1rem';
    btnWrap.innerHTML = `<button class="icon-btn" style="font-size:0.8rem; background:rgba(0,0,0,0.05);" id="btnEditIntent">✏️ Edit Idea</button>`;
    btnWrap.querySelector('button').addEventListener('click', () => { isEditingIntent = true; renderChat(); });
    history.appendChild(btnWrap);
  }

  // 3. Loading Qs
  if (s.status === 'generating_qs') {
    addSys('<div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div> Reading premise...</div>');
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
    
    qData.options.forEach((opt, i) => {
      html += `<button class="qa-btn" data-val="${escAttr(opt)}">${escHtml(opt)}</button>`;
    });
    
    html += `<button class="qa-btn" id="btnCustomAnsToggle">✏️ Write my own answer...</button>`;
    html += `<div class="custom-ans-wrapper hidden" id="customAnsWrap">
               <input type="text" id="customAnsInput" placeholder="Type answer...">
               <button class="danger" id="btnSubmitCustom">Send</button>
             </div>`;
    html += `</div></div>`;
    w.innerHTML = html;
    history.appendChild(w);

    // Bind QA Buttons
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

    scrollToBottom(); return;
  }

  // 6. Loading Prompt
  if (s.status === 'generating_prompt') {
    addSys('<div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div> Synthesizing Master Prompt...</div>');
    scrollToBottom(); return;
  }

  // 7. Done! Display Prompt
  if (s.status === 'done') {
    const w = document.createElement('div'); w.className = 'bubble-wrapper ai';
    w.innerHTML = `<div class="prompt-card"><b>Your Master Prompt is Ready</b><br><br>${escHtml(s.finalPrompt)}</div>
                   <div class="prompt-actions">
                     <button id="btnCopyPromptFinal">📋 Copy Prompt</button>
                     <button class="secondary" id="btnNewChatFromDone">Start New Chat</button>
                   </div>`;
    history.appendChild(w);
    w.querySelector('#btnCopyPromptFinal').addEventListener('click', (e) => { 
      navigator.clipboard.writeText(s.finalPrompt).then(()=> { e.target.textContent = '✅ Copied!'; setTimeout(()=>e.target.textContent='📋 Copy Prompt', 2000)});
    });
    w.querySelector('#btnNewChatFromDone').addEventListener('click', () => { switchSession(createSession()); });
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
  const intentInput = document.getElementById('intentInput');
  const txt = intentInput.value.trim();
  const fileLabel = document.getElementById('attachedFileName').textContent.replace('📎 ', '');

  if (!txt) {
    const err = document.getElementById('dockError'); err.textContent = "Please describe the idea first."; err.style.display = 'block';
    setTimeout(()=>err.style.display='none', 3000);
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
  s.questions = []; s.qaAnswers = []; s.finalPrompt = '';
  s.updatedAt = Date.now();
  if (s.name.startsWith('Chat ')) s.name = txt.slice(0, 20) + '...';
  
  isEditingIntent = false; pendingContextText = '';
  saveSessions(); renderSidebar(); renderChat();

  try {
    const qs = await geminiClient.generateQuestions(s.intent, s.contextText);
    const sUpdated = getActiveSession();
    if (sUpdated.id !== s.id || sUpdated.status !== 'generating_qs') return; // User switched chat or edited again
    
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
  saveSessions(); renderChat();

  if (s.qaAnswers.length === 5) {
    s.status = 'generating_prompt';
    saveSessions(); renderChat();

    try {
      const set = ls('fpm_settings', defaultSettings());
      const res = await geminiClient.generateMasterPrompt(s.intent, s.contextText, s.qaAnswers, set);
      
      const conf = `\n\n---\nBefore you begin writing, please read everything above carefully. Confirm that you understand the characters, their voices, the scenario, and the intended tone. If anything is unclear or you have questions, ask now. Once you are ready, let me know and we will begin.`;
      
      const sUpdated = getActiveSession();
      if(sUpdated.id !== s.id) return;

      sUpdated.finalPrompt = res.trim() + conf;
      sUpdated.status = 'done';
      sUpdated.updatedAt = Date.now();
      saveSessions(); renderChat();

    } catch (e) {
      s.status = 'qa'; // revert status
      s.qaAnswers.pop(); // revert answer to try again
      saveSessions(); renderChat();
      alert("Failed to build prompt: " + e.message);
    }
  }
}

// ============================================================
// SETTINGS SYNC (THEME, COLORS, VARS)
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
    if (col && col.startsWith('#') && col.length === 4) col = '#'+col[1]+col[1]+col[2]+col[2]+col[3]+col[3]; // hex3 to hex6
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
  s.model = document.getElementById('modelSelect')?.value || 'gemini-2.5-flash';
  s.toneHints = document.getElementById('toneHintsInput').value.trim();
  s.styleDirectives = Array.from(document.querySelectorAll('input[name="styleDirective"]:checked')).map(c=>c.value);
  s.promptLength = document.querySelector('input[name="promptLength"]:checked')?.value || 'standard';
  s.povMode = document.querySelector('input[name="povMode"]:checked')?.value || 'thirdLimited';
  return s;
}

// ============================================================
// EVENT LISTENERS BINDING
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

  // Dock Input Area
  const intentInput = document.getElementById('intentInput');
  document.getElementById('btnSendIntent').addEventListener('click', flushIntent);
  intentInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); flushIntent(); }
  });
  
  // File attachments
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

  // API Key manager UI
  const rdrKeys = () => {
    const keys = getApiKeys(); const actId = ls('fpm_active_key_id', null);
    const lst = document.getElementById('apiKeyManagerList');
    lst.innerHTML = keys.length ? keys.map(k=>`<div class="api-key-item ${k.id===actId?'active-key':''}">
      <span class="key-name">${escHtml(k.name)}</span><span class="key-value">${k.key.slice(0,6)}...</span>
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

  // Initial overlay Auth layer
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

  // Settings Overlay Toggles
  const sOl = document.getElementById('settingsOverlay');
  document.getElementById('btnOpenSettings').addEventListener('click', () => { rdrKeys(); sOl.classList.add('active'); });
  document.getElementById('btnSettingsClose').addEventListener('click', () => {
    const s = readSettingsUI(); ss('fpm_settings', s); rebuildGemini(); sOl.classList.remove('active');
  });

  // Theme Switches
  document.querySelectorAll('.theme-card').forEach(c => c.addEventListener('click', () => {
    const tn = c.dataset.theme; const s = ls('fpm_settings', defaultSettings());
    s.theme = tn; s.customColors = { ...THEMES[tn] }; ss('fpm_settings', s); syncSettingsUI();
  }));

  // Color Pickers
  document.querySelectorAll('input[type="color"][data-var]').forEach(p => {
    p.addEventListener('input', () => {
      const v = p.dataset.var; const val = p.value;
      document.documentElement.style.setProperty(v, val);
      if (v === '--accent-color') document.documentElement.style.setProperty('--accent-hover', val); // simplifed hover sync
      const s = ls('fpm_settings', defaultSettings());
      s.theme = 'custom'; s.customColors[v] = val; ss('fpm_settings', s);
      document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
    });
  });

  // Reset Button
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
