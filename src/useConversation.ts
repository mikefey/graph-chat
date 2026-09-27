import { useCallback, useEffect, useRef, useState } from 'react';
import { ROOT_ID, type ChatNode, type Tree } from './types';

const STORAGE_KEY = 'relational-chat:v1';

function freshTree(): Tree {
  return {
    [ROOT_ID]: { id: ROOT_ID, parentId: null, role: 'root', content: '', status: 'done', createdAt: Date.now() },
  };
}

function loadTree(): Tree {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Tree | null;
    if (!saved?.[ROOT_ID]) return freshTree();
    // A reload kills any in-flight stream.
    for (const n of Object.values(saved)) {
      if (n.status === 'streaming') {
        n.status = n.content ? 'done' : 'error';
        if (!n.content) n.content = '(interrupted)';
      }
    }
    return saved;
  } catch {
    return freshTree();
  }
}

/** Nodes from the root down to `id`, inclusive. */
export function pathTo(tree: Tree, id: string): ChatNode[] {
  const path: ChatNode[] = [];
  for (let n: ChatNode | undefined = tree[id]; n; n = n.parentId ? tree[n.parentId] : undefined) {
    path.unshift(n);
  }
  return path;
}

const makeNode = (parentId: string, role: ChatNode['role'], content = '', status: ChatNode['status'] = 'done'): ChatNode => ({
  id: crypto.randomUUID(),
  parentId,
  role,
  content,
  status,
  createdAt: Date.now(),
});

export function useConversation() {
  const [tree, setTree] = useState<Tree>(loadTree);
  const [selectedId, setSelectedId] = useState<string>(ROOT_ID);
  const streams = useRef(new Map<string, AbortController>());

  // Debounced persistence so streaming tokens don't hammer localStorage.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
      } catch {
        // Storage full or unavailable — the session still works.
      }
    }, 300);
    return () => clearTimeout(t);
  }, [tree]);

  const patch = (id: string, fn: (n: ChatNode) => Partial<ChatNode>) =>
    setTree((t) => (t[id] ? { ...t, [id]: { ...t[id], ...fn(t[id]) } } : t));

  const stream = useCallback(async (assistantId: string, history: ChatNode[]) => {
    const abort = new AbortController();
    streams.current.set(assistantId, abort);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          messages: history.filter((n) => n.role !== 'root').map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        patch(assistantId, (n) => ({ content: n.content + value }));
      }
      patch(assistantId, (n) => ({ status: n.content ? 'done' : 'error', content: n.content || '(empty response)' }));
    } catch (err) {
      if (abort.signal.aborted) return;
      patch(assistantId, () => ({ status: 'error', content: `Error: ${(err as Error).message}` }));
    } finally {
      streams.current.delete(assistantId);
    }
  }, []);

  /**
   * Send a message branching from the selected node. If the selected node is a
   * user message, the new message becomes an alternative to it (a sibling).
   */
  const send = useCallback(
    (text: string) => {
      const selected = tree[selectedId] ?? tree[ROOT_ID];
      const parentId = selected.role === 'user' ? selected.parentId! : selected.id;
      const user = makeNode(parentId, 'user', text);
      const assistant = makeNode(user.id, 'assistant', '', 'streaming');
      const next = { ...tree, [user.id]: user, [assistant.id]: assistant };
      setTree(next);
      setSelectedId(assistant.id);
      stream(assistant.id, pathTo(next, user.id));
    },
    [tree, selectedId, stream],
  );

  /** New assistant reply to the selected user message (or the one above the selected reply). */
  const regenerate = useCallback(() => {
    const selected = tree[selectedId];
    const userId = selected?.role === 'user' ? selected.id : selected?.role === 'assistant' ? selected.parentId : null;
    if (!userId) return;
    const assistant = makeNode(userId, 'assistant', '', 'streaming');
    setTree({ ...tree, [assistant.id]: assistant });
    setSelectedId(assistant.id);
    stream(assistant.id, pathTo(tree, userId));
  }, [tree, selectedId, stream]);

  const clear = useCallback(() => {
    streams.current.forEach((a) => a.abort());
    streams.current.clear();
    setTree(freshTree());
    setSelectedId(ROOT_ID);
  }, []);

  return { tree, selectedId, select: setSelectedId, send, regenerate, clear };
}
