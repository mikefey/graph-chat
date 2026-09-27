import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All provider config comes from the environment (.env locally, gitignored).
const {
  LLM_BASE_URL,
  LLM_API_KEY,
  LLM_MODEL,
  LLM_SYSTEM_PROMPT,
  LLM_TEMPERATURE,
  LLM_MAX_TOKENS,
  PORT = '8787',
} = process.env;

const missing = Object.entries({ LLM_BASE_URL, LLM_API_KEY, LLM_MODEL })
  .filter(([, v]) => !v || v.includes('<'))
  .map(([k]) => k);
const configError = missing.length
  ? `Missing or placeholder env vars: ${missing.join(', ')}. Fill them in .env and restart.`
  : null;
if (configError) console.error(configError);

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/config', (_req, res) => {
  // Only expose the model name — never the key or endpoint.
  res.json({ model: LLM_MODEL });
});

// Body: { messages: [{ role: 'user' | 'assistant', content: string }] }
// Response: plain-text stream of the assistant's reply.
app.post('/api/chat', async (req, res) => {
  if (configError) return res.status(500).json({ error: configError });
  const history = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!history?.length) return res.status(400).json({ error: 'messages required' });

  const messages = [
    ...(LLM_SYSTEM_PROMPT ? [{ role: 'system', content: LLM_SYSTEM_PROMPT }] : []),
    ...history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(({ role, content }) => ({ role, content })),
  ];

  const abort = new AbortController();
  res.on('close', () => abort.abort());

  let upstream;
  try {
    upstream = await fetch(`${LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        stream: true,
        ...(LLM_TEMPERATURE && { temperature: Number(LLM_TEMPERATURE) }),
        ...(LLM_MAX_TOKENS && { max_tokens: Number(LLM_MAX_TOKENS) }),
      }),
    });
  } catch (err) {
    if (abort.signal.aborted) return;
    return res.status(502).json({ error: `Could not reach LLM: ${err.message}` });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return res.status(upstream.status || 502).json({ error: text || upstream.statusText });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  // Translate the upstream SSE stream into raw text deltas.
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const data = line.trim().replace(/^data:\s*/, '');
        if (!line.trim().startsWith('data:') || data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch {
          // Ignore keep-alives / partial junk.
        }
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) console.error('Stream error:', err.message);
  }
  res.end();
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(Number(PORT), () => {
  console.log(`API listening on http://localhost:${PORT} (model: ${LLM_MODEL})`);
});
