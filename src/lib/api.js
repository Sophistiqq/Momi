// All reads/writes go through the edge function, which validates the session
// cookie and uses the service-role client (bypasses RLS).
export async function fetchPosts() {
  const res = await fetch('/share-target/posts', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function fetchComments(postId) {
  const res = await fetch(`/share-target/posts/${postId}/comments`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function addComment(postId, body) {
  const res = await fetch(`/share-target/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ body }),
  });
  return res.ok;
}

export async function saveCaption(postId, caption) {
  const res = await fetch(`/share-target/posts/${postId}/caption`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ caption }),
  });
  return res.ok;
}

export function formatDate(s) {
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(s) {
  return new Date(s).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
