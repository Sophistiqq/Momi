const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);

export async function processImage(file: File): Promise<{
  bytes: Uint8Array;
  contentType: string;
  placeholder: string | null;
} | null> {
  const B = (globalThis as any).Bun;
  if (!B?.Image || !SUPPORTED.has(file.type)) return null;

  try {
    const input = new Uint8Array(await file.arrayBuffer());
    const img = () => new B.Image(input);
    const [processed, placeholder] = await Promise.all([
      img().resize(2048, undefined, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).bytes(),
      img().resize(2048, undefined, { fit: 'inside', withoutEnlargement: true }).placeholder(),
    ]);
    return { bytes: processed, contentType: 'image/webp', placeholder };
  } catch (e) {
    console.error('Bun.Image failed, uploading original:', e);
    return null;
  }
}
