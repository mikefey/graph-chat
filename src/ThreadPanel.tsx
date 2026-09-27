import { useEffect, useRef, useState } from 'react';
import { ROOT_ID, type ChatNode, type Tree } from './types';

interface Props {
  tree: Tree;
  path: ChatNode[];
  selected: ChatNode;
  model: string | null;
  onSelect: (id: string) => void;
  onSend: (text: string) => void;
  onRegenerate: () => void;
  onClear: () => void;
}

export function ThreadPanel({ tree, path, selected, model, onSelect, onSend, onRegenerate, onClear }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const messages = path.filter((n) => n.role !== 'root');
  const childCount = Object.values(tree).filter((n) => n.parentId === selected.id).length;
  const busy = selected.status === 'streaming';

  const lastContent = messages.at(-1)?.content;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [selected.id, lastContent]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft('');
  };

  const placeholder =
    selected.role === 'root'
      ? 'Start a new conversation…'
      : selected.role === 'user'
        ? 'Write an alternative to the selected message…'
        : 'Reply from here…';

  return (
    <aside className="panel">
      <header>
        <div>
          <h1>Relational Chat</h1>
          {model && <span className="model">{model}</span>}
        </div>
        <div className="actions">
          <button onClick={() => onSelect(ROOT_ID)} disabled={selected.id === ROOT_ID}>
            New
          </button>
          <button
            onClick={() => {
              if (confirm('Delete every conversation?')) onClear();
            }}
          >
            Clear
          </button>
        </div>
      </header>

      <div className="thread" ref={listRef}>
        {messages.length === 0 && (
          <p className="empty">
            Every message becomes a node in the graph. Click any earlier node to branch the conversation from that
            point.
          </p>
        )}
        {messages.map((n) => (
          <button
            key={n.id}
            className={`msg ${n.role} ${n.status} ${n.id === selected.id ? 'selected' : ''}`}
            onClick={() => onSelect(n.id)}
          >
            <span className="role">{n.role === 'user' ? 'You' : 'Assistant'}</span>
            <span className="content">{n.content || '…'}</span>
          </button>
        ))}
        {childCount > 0 && selected.id !== ROOT_ID && (
          <p className="branch-note">
            {childCount} {childCount === 1 ? 'branch continues' : 'branches continue'} from here. Sending creates a new
            one.
          </p>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          placeholder={placeholder}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-actions">
          {selected.role !== 'root' && (
            <button type="button" onClick={onRegenerate} disabled={busy}>
              Regenerate
            </button>
          )}
          <button type="submit" className="primary" disabled={!draft.trim() || busy}>
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
