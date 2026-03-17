// Gemini REST API Service — vanilla fetch, no npm required

export class GeminiService {
  /**
   * @param {string} apiKey   - Google Gemini API key
   * @param {string} model    - Gemini model ID (e.g. 'gemini-2.5-flash')
   */
  constructor(apiKey, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model  = model;
  }

  /** Build the endpoint URL fresh each call so model/key changes apply immediately */
  _url() {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
  }

  async _callApi(systemInstruction, userContent, isJson = false) {
    const payload = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0.75 }
    };

    if (isJson) {
      payload.generationConfig.response_mime_type = 'application/json';
    }

    let response;
    try {
      response = await fetch(this._url(), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      });
    } catch (networkErr) {
      throw new Error(`Network error — check your internet connection. (${networkErr.message})`);
    }

    if (!response.ok) {
      let msg = response.statusText;
      try { const j = await response.json(); msg = j.error?.message || msg; } catch {}
      throw new Error(`Gemini API error ${response.status}: ${msg}`);
    }

    const data = await response.json();

    // Handle safety-blocked or empty responses
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('No response from the model. The request may have been blocked.');
    if (candidate.finishReason === 'SAFETY') throw new Error('Response blocked by safety filters. Try rephrasing your idea.');

    return candidate.content?.parts?.[0]?.text ?? '';
  }

  // ── Question Generation ─────────────────────────────────────

  async generateQuestions(intent, contextText) {
    const system = `You are an expert interactive prompt engineer helping a fanfiction writer.
Generate exactly 5 targeted, clarifying questions about the fanfiction they want to write.
For each question, provide exactly 3 short, distinct answer options.

IMPORTANT: Respond ONLY with a valid JSON array. No markdown fences, no extra text.
Schema:
[
  { "question": "...", "options": ["...", "...", "..."] }
]`;

    const user = [
      'USER INTENT:',
      intent,
      contextText ? `\nBACKGROUND CONTEXT / LORE:\n${contextText}` : ''
    ].join('\n');

    const raw = await this._callApi(system, user, true);

    // Strip accidental markdown fences if the model adds them
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let questions;
    try { questions = JSON.parse(cleaned); }
    catch {
      console.error('JSON parse failed. Raw response:', raw);
      throw new Error('The model returned an unexpected format. Please try again.');
    }

    if (!Array.isArray(questions) || questions.length < 5) {
      throw new Error('The model did not return 5 questions. Please try again.');
    }

    // Normalise — accept up to 5
    return questions.slice(0, 5).map(q => ({
      question: String(q.question || 'Question missing'),
      options:  (Array.isArray(q.options) ? q.options : []).slice(0, 3).map(String)
    }));
  }

  // ── Final Prompt Generation ─────────────────────────────────

  async generateMasterPrompt(intent, contextText, qaPairs, settings) {
    const directives = this._buildDirectives(settings.styleDirectives || []);
    const povLabel   = { firstPerson: 'First Person', thirdLimited: 'Third Person Limited', thirdOmniscient: 'Third Person Omniscient' }[settings.povMode] || 'Third Person Limited';
    const lengthNote = { concise: 'Keep the brief concise and focused.', standard: 'Use a balanced level of detail.', detailed: 'Provide maximum context — be exhaustive.' }[settings.promptLength] || '';

    const system = `You are a master prompt engineer creating a creative writing brief for another LLM (e.g. Claude, GPT-4, Gemini).
Your job is NOT to write the story — your job is to write a rich, detailed PROMPT that will instruct another AI to write it.

Rules:
- The brief must be long, specific, and leave no room for the AI to guess.
- Characters must be described with their exact voice, personality, speech quirks, and mannerisms.
- Describe where the scene starts, how it escalates, and what the emotional resolution should be.
- ${lengthNote}
- Write in ${povLabel} perspective throughout.

Required writing style directives to embed in the prompt:
${directives || '(No specific style directives selected.)'}

Output ONLY the final prompt text. Do not add any preamble or meta-commentary.`;

    const qnaBlock = qaPairs.map((p, i) => `Q${i + 1}: ${p.question}\nAnswer: ${p.answer}`).join('\n\n');

    const user = [
      `USER'S FANFIC IDEA:\n${intent}`,
      contextText ? `BACKGROUND CONTEXT / LORE:\n${contextText}` : '',
      `CLARIFYING Q&A:\n${qnaBlock}`,
      settings.toneHints ? `ADDITIONAL TONE NOTES: ${settings.toneHints}` : ''
    ].filter(Boolean).join('\n\n');

    const raw = await this._callApi(system, user, false);
    return raw.trim();
  }

  // ── Helpers ─────────────────────────────────────────────────

  _buildDirectives(keys) {
    const map = {
      onomatopoeia:     '- Onomatopoeic Dialogue: Weave sound words naturally into narration and speech (thud, hiss, click, etc.).',
      sensory:          '- Vivid Sensory Description: Use all five senses. Show, don\'t tell.',
      internalThinks:   '- Inward Thinking: Include the POV character\'s unfiltered inner voice in italics, revealing doubts and feelings.',
      paragraphVariety: '- Paragraph Variety: Alternate between short punchy sentences and longer flowing ones to control pacing.',
      characterAccuracy:'- Character Voice Accuracy: Each character must speak and react true to their established personality, speech patterns, and quirks.',
      dialogueHeavy:    '- Dialogue-Heavy: Drive the scene primarily through conversation, with action/description woven in.',
      emotionalDepth:   '- Emotional Depth: Make the reader feel the tension, vulnerability, or warmth. Don\'t skim emotional beats.',
      continuity:       '- Scene Continuity: End the scene with a natural lead-in to the next beat — never abrupt.',
    };
    return keys.map(k => map[k]).filter(Boolean).join('\n');
  }
}
