// All reads/writes go through the edge function, which validates the session
// cookie and uses the service-role client (bypasses RLS).

export interface Media {
  id: string;
  object_key: string;
  mime_type: string;
  sort_order: number;
  url: string;
}

export interface Post {
  id: string;
  caption: string;
  author: string;
  created_at: string;
  status: string;
  location?: string | null;
  post_media: Media[];
}

export interface Comment {
  id: string;
  post_id: string;
  author: string;
  body: string;
  created_at: string;
}

export async function fetchPosts(): Promise<Post[]> {
  const res = await fetch('/share-target/posts', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function fetchComments(postId: string): Promise<Comment[]> {
  const res = await fetch(`/share-target/posts/${postId}/comments`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function addComment(postId: string, body: string): Promise<boolean> {
  const res = await fetch(`/share-target/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ body }),
  });
  return res.ok;
}

export async function saveCaption(postId: string, caption: string): Promise<boolean> {
  const res = await fetch(`/share-target/posts/${postId}/caption`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ caption }),
  });
  return res.ok;
}

export function formatDate(s: string | number | Date): string {
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(s: string | number | Date): string {
  return new Date(s).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
