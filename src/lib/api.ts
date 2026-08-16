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
  lat?: number | null;
  lng?: number | null;
  mentions?: string[];
  post_media: Media[];
}

export interface Comment {
  id: string;
  post_id: string;
  author: string;
  body: string;
  created_at: string;
}

export async function fetchPosts(options?: { status?: string; limit?: number; before?: string } | string): Promise<Post[]> {
  let url = '/share-target/posts';
  const params = new URLSearchParams();
  if (typeof options === 'string') {
    params.set('status', options);
  } else if (options) {
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.before) params.set('before', options.before);
  }
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export interface People {
  me: string;
  other: string | null;
}

// The two people in this journal, for @mentions on the customize page.
export async function fetchPeople(): Promise<People> {
  const res = await fetch('/share-target/people', { headers: { Accept: 'application/json' } });
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
  fields: { caption?: string; location?: string; status?: string; lat?: number | null; lng?: number | null }
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

/** Permanently removes a post that is already in trash (storage + DB). */
export async function purgePost(postId: string): Promise<boolean> {
  // First DELETE soft-trashes; second DELETE on an already-trashed post hard-deletes.
  // Since we only call this from the trash view the post is already trashed,
  // so one DELETE call triggers the hard-delete branch in the edge function.
  const res = await fetch(`/share-target/posts/${postId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  return res.ok;
}

/** Restore a trashed post back to the main feed. */
export async function restorePost(postId: string): Promise<boolean> {
  return updatePost(postId, { status: 'pending_style' });
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
