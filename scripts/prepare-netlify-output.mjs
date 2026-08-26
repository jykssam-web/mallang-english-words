import { cp, stat } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('dist/client');
const destination = path.resolve('out');

try {
  await stat(source);
} catch {
  throw new Error('Static build output was not created at dist/client.');
}

await cp(source, destination, { recursive: true });
