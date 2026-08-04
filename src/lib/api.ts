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

export async function fetchPosts(status?: string): Promise<Post[]> {
  const url = status ? `/share-target/posts?status=${status}` : '/share-target/posts';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
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

export async function updatePost(
  postId: string,
  fields: { caption?: string; location?: string; status?: string }
): Promise<boolean> {
  const res = await fetch(`/share-target/posts/${postId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(fields),
  });
  return res.ok;
}

export async function deletePost(postId: string): Promise<boolean> {
  const res = await fetch(`/share-target/posts/${postId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
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
