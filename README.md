# Graph Chat

An LLM chat where every message is a node in a force-directed graph. Replies spawn new nodes
linked to the message before them. Click any earlier node to branch the conversation from there.

## Setup

```sh
npm install
cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
npm run dev            # API on :8787, UI on http://localhost:5173
```

`.env` is gitignored. The browser never sees the key or endpoint: it only calls `/api/chat`,
and the Node server forwards the request to the provider.

Any OpenAI-compatible `/chat/completions` endpoint works. To switch providers, change
`LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`.

## How branching works

- **Assistant node selected** → your message continues from that reply.
- **User node selected** → your message becomes an alternative to it (a sibling branch).
- **Start node selected** → begins a new conversation.
- **Regenerate** → another reply to the same user message, as a new branch.

Only the path from the start node to the new message is sent to the model as context.
Conversations are saved in `localStorage`.

## Production

```sh
npm run build && npm start   # serves dist/ and the API from one process
```
