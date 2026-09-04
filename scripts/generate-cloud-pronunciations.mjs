import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const projectId = 'mallang-english-words-0902';
const cloudConfig = path.join(root, 'secrets', 'gcloud-config');
const accentArgument = process.argv.find((argument) => argument.startsWith('--accent='));
const accent = accentArgument?.split('=')[1] ?? 'en-US';
const testMode = process.argv.includes('--test');
const concurrency = 8;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (!['en-US', 'en-GB'].includes(accent)) throw new Error('Accent must be en-US or en-GB');

let cachedAccessToken = '';
let tokenCreatedAt = 0;

function getAccessToken(force = false) {
  if (!force && cachedAccessToken && Date.now() - tokenCreatedAt < 45 * 60 * 1000) return cachedAccessToken;
  const gcloudScript = path.join(process.env.LOCALAPPDATA, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.ps1');
  cachedAccessToken = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', gcloudScript, 'auth', 'application-default', 'print-access-token'], {
    encoding: 'utf8', env: { ...process.env, CLOUDSDK_CONFIG: cloudConfig },
  }).trim();
  tokenCreatedAt = Date.now();
  return cachedAccessToken;
}

function fileName(word) {
  return `${word.toLowerCase().replace(/[^a-z0-9-]/g, '_')}.mp3`;
}

function parseWords(source) {
  return source.split(/\r?\n/).map((line) => line.trim().match(/^(\S+)\s+(.+)$/))
    .filter(Boolean).map((match) => ({ word: match[1].toLowerCase(), meaning: match[2].trim() }));
}

async function exists(filePath) {
  try { await stat(filePath); return true; } catch { return false; }
}

async function synthesize(item) {
  const destination = path.join(root, 'public', 'audio', accent, item.kind === 'word' ? 'words' : 'sentences', fileName(item.word));
  if (await exists(destination)) return 'exists';
  await mkdir(path.dirname(destination), { recursive: true });
  let accessToken = getAccessToken();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'x-goog-user-project': projectId, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: item.text },
        voice: { languageCode: accent, name: `${accent}-Chirp3-HD-Iapetus` },
        audioConfig: { audioEncoding: 'MP3', ...(item.kind === 'sentence' ? { speakingRate: 0.85 } : {}) },
      }),
    });
    if (response.ok) {
      const payload = await response.json();
      await writeFile(destination, Buffer.from(payload.audioContent, 'base64'));
      return 'created';
    }
    if (response.status === 401) { accessToken = getAccessToken(true); continue; }
    if (![429, 500, 502, 503, 504].includes(response.status)) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(`${item.word}: Cloud TTS failed (${response.status}) ${payload?.error?.message ?? ''}`);
    }
    await pause(Math.min(60, 2 ** attempt) * 1000);
  }
  throw new Error(`${item.word}: Cloud TTS retries exhausted`);
}

async function worker(queue, progress) {
  while (queue.length) {
    const item = queue.shift();
    const result = await synthesize(item);
    progress.done += 1;
    console.log(`[${progress.done}/${progress.total}] ${result}: ${item.kind} ${item.word}`);
  }
}

async function main() {
  const source = await readFile(path.join(root, 'public', 'data', '800-words.txt'), 'utf8');
  const words = parseWords(source);
  const lessons = JSON.parse(await readFile(path.join(root, 'public', 'data', 'sentence-lessons.json'), 'utf8'));
  const sentences = new Map(lessons.map((lesson) => [lesson.word, lesson.sentence]));
  if (!testMode && sentences.size !== words.length) throw new Error(`Expected ${words.length} sentence lessons, found ${sentences.size}`);
  const items = [];
  for (const { word } of words) {
    items.push({ kind: 'word', word, text: word.replaceAll('/', ', ') });
    if (sentences.has(word)) items.push({ kind: 'sentence', word, text: sentences.get(word) });
    if (testMode) break;
  }
  const queue = [...items]; const progress = { done: 0, total: items.length };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker(queue, progress)));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
