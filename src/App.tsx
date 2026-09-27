import { useEffect, useMemo, useState } from 'react';
import { Graph } from './Graph';
import { ThreadPanel } from './ThreadPanel';
import { pathTo, useConversation } from './useConversation';
import { ROOT_ID } from './types';

export function App() {
  const { tree, selectedId, select, send, regenerate, clear } = useConversation();
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => setModel(c.model))
      .catch(() => setModel(null));
  }, []);

  const selected = tree[selectedId] ?? tree[ROOT_ID];
  const path = useMemo(() => pathTo(tree, selected.id), [tree, selected.id]);
  const activePath = useMemo(() => new Set(path.map((n) => n.id)), [path]);

  return (
    <div className="app">
      <Graph tree={tree} selectedId={selected.id} activePath={activePath} onSelect={select} />
      <ThreadPanel
        tree={tree}
        path={path}
        selected={selected}
        model={model}
        onSelect={select}
        onSend={send}
        onRegenerate={regenerate}
        onClear={clear}
      />
    </div>
  );
}
