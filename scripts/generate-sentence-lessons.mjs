import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outputPath = path.join(root, 'public', 'data', 'sentence-lessons.json');
const projectId = 'mallang-english-words-0902';
const cloudConfig = path.join(root, 'secrets', 'gcloud-config');
const batchSize = 25;
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Infinity;

let cachedAccessToken = '';
let tokenCreatedAt = 0;

function getAccessToken(force = false) {
  if (!force && cachedAccessToken && Date.now() - tokenCreatedAt < 45 * 60 * 1000) return cachedAccessToken;
  const gcloudScript = path.join(process.env.LOCALAPPDATA, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.ps1');
  cachedAccessToken = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', gcloudScript, 'auth', 'application-default', 'print-access-token'], {
    encoding: 'utf8',
    env: { ...process.env, CLOUDSDK_CONFIG: cloudConfig },
  }).trim();
  tokenCreatedAt = Date.now();
  return cachedAccessToken;
}

function parseWords(source) {
  return source.split(/\r?\n/).map((line) => line.trim().match(/^(\S+)\s+(.+)$/))
    .filter(Boolean).map((match) => ({ word: match[1].toLowerCase(), meaning: match[2].trim() }));
}

function parseJson(text) {
  const clean = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(clean);
}

function fallbackLesson(item) {
  return {
    word: item.word,
    sentence: `I can say "${item.word}".`,
    orderHint: '나는 | 말할 수 있다 | 이 단어를',
    translation: `나는 “${item.word}”라는 단어를 말할 수 있다.`,
  };
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function generateBatch(words) {
  const list = words.map(({ word, meaning }) => ({ word, meaning }));
  const prompt = `Create learning sentences for Korean elementary English students. Return ONLY a JSON array, with one object for every input item and no markdown. Each object must have exactly these keys: word, sentence, orderHint, translation.\n\nRules:\n- Keep the word unchanged from the input.\n- sentence must use that exact English word naturally in a short, clear American English sentence of 3 to 9 words.\n- orderHint is a Korean literal word-order guide for the English sentence, with meaningful chunks divided by " | ". It must help a child follow English order, rather than being a natural Korean translation.\n- translation is a short, natural Korean translation.\n- Use child-safe everyday situations only.\n\nInput: ${JSON.stringify(list)}`;
  let response; let accessToken = getAccessToken();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await fetch(`https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
    });
    if (response.ok) break;
    if (response.status === 401) { accessToken = getAccessToken(true); continue; }
    if (response.status !== 429 || attempt === 7) throw new Error(`Sentence request failed (${response.status})`);
    const waitSeconds = Math.min(120, 15 * (attempt + 1));
    console.log(`Sentence rate limit reached. Waiting ${waitSeconds} seconds before retrying.`);
    await pause(waitSeconds * 1000);
  }
  if (!response?.ok) throw new Error('Sentence request did not complete');
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
  if (!text) throw new Error('No text in Gemini response');
  const lessons = parseJson(text);
  if (!Array.isArray(lessons)) throw new Error('Sentence response was not an array');
  const byWord = new Map(lessons.map((lesson) => [String(lesson.word).toLowerCase(), lesson]));
  return words.map((item) => {
    const lesson = byWord.get(item.word);
    if (!lesson?.sentence?.toLowerCase().includes(item.word) || !lesson.orderHint || !lesson.translation) return fallbackLesson(item);
    return { word: item.word, sentence: lesson.sentence, orderHint: lesson.orderHint, translation: lesson.translation };
  });
}

async function main() {
  const source = await readFile(path.join(root, 'public', 'data', '800-words.txt'), 'utf8');
  const words = parseWords(source).slice(0, limit);
  let savedLessons = [];
  try { savedLessons = JSON.parse(await readFile(outputPath, 'utf8')); } catch { /* first run */ }
  const lessonsByWord = new Map(savedLessons.map((lesson) => [lesson.word, lesson]));
  const remaining = words.filter((item) => !lessonsByWord.has(item.word));
  await mkdir(path.dirname(outputPath), { recursive: true });
  for (let offset = 0; offset < remaining.length; offset += batchSize) {
    const batch = remaining.slice(offset, offset + batchSize);
    for (const lesson of await generateBatch(batch)) lessonsByWord.set(lesson.word, lesson);
    const ordered = words.map((item) => lessonsByWord.get(item.word)).filter(Boolean);
    await writeFile(outputPath, `${JSON.stringify(ordered, null, 2)}\n`);
    console.log(`[${ordered.length}/${words.length}] sentence lessons created`);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
