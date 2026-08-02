const MODEL_PATH = /^\/api\/character-assets\/models\/\d+\/[^/]+$/;
const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.ply', '.stl'];

export async function uploadCharacterModel(file: File): Promise<string> {
  const filename = file.name.toLowerCase();
  if (!MODEL_EXTENSIONS.some((extension) => filename.endsWith(extension))) {
    throw new Error('Choose an OBJ, GLB, GLTF, PLY, or STL model file.');
  }
  if (file.size > 50 * 1024 * 1024) {
    throw new Error('3D token files must be smaller than 50 MB.');
  }
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/character-assets/models', {
    body: form,
    method: 'POST',
  });
  const result = await response.json().catch(() => ({})) as {
    message?: string;
    url?: string;
  };
  if (!response.ok || !result.url) {
    throw new Error(result.message || 'The 3D token could not be uploaded.');
  }
  return result.url;
}

export async function deleteCharacterModel(url?: string): Promise<void> {
  if (!url || !MODEL_PATH.test(url)) return;
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    const result = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(result.message || 'The 3D token could not be removed.');
  }
}
