// Preloaded into a test server: fakes Groq/OpenAI transcription endpoints.
// MOCK_GROQ / MOCK_OPENAI = "ok" | HTTP status to fail with.
const real = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
global.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.includes('/audio/transcriptions')) return real(url, init);
  const auth = (init && init.headers && (init.headers.Authorization || init.headers.authorization || (init.headers.get && init.headers.get('authorization')))) || '';
  // MOCK_EXHAUSTED_KEY: that key answers 429 (limit reached)
  if (process.env.MOCK_EXHAUSTED_KEY && String(auth).includes(process.env.MOCK_EXHAUSTED_KEY)) return json({ error: { message: 'limit' } }, 429);
  const mode = u.includes('groq.com') ? process.env.MOCK_GROQ : process.env.MOCK_OPENAI;
  if (mode !== 'ok') return json({ error: { message: 'mock failure', code: mode === '429q' ? 'insufficient_quota' : null } }, parseInt(mode));
  return json({ text: (u.includes('groq.com') ? 'groq' : 'openai') + ' heard John 3 16' });
};

// Detection: Claude and Groq chat, MOCK_CLAUDE / MOCK_GROQ_CHAT = "ok" | status
const realFetch2 = global.fetch;
global.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.includes('anthropic.com')) {
    const m = process.env.MOCK_CLAUDE;
    if (m !== 'ok') return json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, parseInt(m));
    return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: '{"type":"implicit","candidates":[{"book":"John","chapter":3,"verse":16,"confidence":0.8}],"confidence":0.8}' }] });
  }
  if (u.includes('groq.com') && u.endsWith('/models')) return json({ object: 'list', data: [{ id: 'llama-3.3-70b-versatile' }] });
  if (u.includes('groq.com') && u.includes('/chat/completions')) {
    const m = process.env.MOCK_GROQ_CHAT;
    if (m !== 'ok') return json({ error: { message: 'limit' } }, parseInt(m));
    return json({ id: 'x', object: 'chat.completion', created: 0, model: 'llama-3.3-70b-versatile', choices: [{ index: 0, finish_reason: 'stop',
      message: { role: 'assistant', content: '{"type":"implicit","candidates":[{"book":"John","chapter":3,"verse":16,"confidence":0.8}],"confidence":0.8}' } }] });
  }
  return realFetch2(url, init);
};
