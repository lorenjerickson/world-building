import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export const uploadDirectory = join(process.cwd(), 'data', 'uploads');
mkdirSync(uploadDirectory, { recursive: true });

export function storeImage(buffer: Buffer, extension = '.png') {
  const filename = `${randomUUID()}${extension}`;
  writeFileSync(join(uploadDirectory, filename), buffer, { flag: 'wx' });
  return { filename, url: `/uploads/${filename}` };
}
