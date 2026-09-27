export type Role = 'root' | 'user' | 'assistant';

export interface ChatNode {
  id: string;
  parentId: string | null;
  role: Role;
  content: string;
  status: 'done' | 'streaming' | 'error';
  createdAt: number;
}

export type Tree = Record<string, ChatNode>;

export const ROOT_ID = 'root';
