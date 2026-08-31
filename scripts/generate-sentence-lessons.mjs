import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outputPath = path.join(root, 'public', 'data', 'sentence-lessons.json');
const batchSize = 20;
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Infinity;

async function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envText = await readFile(path.join(root, '.env.local'), 'utf8');
  return envText.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

function parseWords(source) {
  return source.split(/\r?\n/).map((line) => line.trim().match(/^(\S+)\s+(.+)$/))
    .filter(Boolean).map((match) => ({ word: match[1].toLowerCase(), meaning: match[2].trim() }));
}

function parseJson(text) {
  const clean = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(clean);
}

function findText(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  for (const child of Object.values(value)) {
    const text = findText(child);
    if (text) return text;
  }
  return null;
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForCompletion(interaction, apiKey) {
  let latest = interaction;
  for (let attempt = 0; latest.status === 'in_progress' && attempt < 90; attempt += 1) {
    await pause(1000);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${latest.id}`, { headers: { 'x-goog-api-key': apiKey } });
    if (!response.ok) throw new Error(`Sentence status request failed (${response.status})`);
    latest = await response.json();
  }
  if (latest.status !== 'completed') throw new Error(`Sentence interaction did not complete (${latest.status ?? 'unknown'})`);
  return latest;
}

async function generateBatch(words, apiKey) {
  const list = words.map(({ word, meaning }) => ({ word, meaning }));
  const prompt = `Create learning sentences for Korean elementary English students. Return ONLY a JSON array, with one object for every input item and no markdown. Each object must have exactly these keys: word, sentence, orderHint, translation.\n\nRules:\n- Keep the word unchanged from the input.\n- sentence must use that exact English word naturally in a short, clear American English sentence of 3 to 9 words.\n- orderHint is a Korean literal word-order guide for the English sentence, with meaningful chunks divided by " | ". It must help a child follow English order, rather than being a natural Korean translation.\n- translation is a short, natural Korean translation.\n- Use child-safe everyday situations only.\n\nInput: ${JSON.stringify(list)}`;
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({ model: 'gemini-3.6-flash', input: prompt, response_format: { type: 'text', mime_type: 'application/json' }, generation_config: { temperature: 0.2 } }),
  });
  if (!response.ok) throw new Error(`Sentence request failed (${response.status})`);
  const payload = await waitForCompletion(await response.json(), apiKey);
  const text = payload?.output_text ?? findText(payload?.steps);
  if (!text) throw new Error('No text in Gemini response');
  const lessons = parseJson(text);
  if (!Array.isArray(lessons)) throw new Error('Sentence response was not an array');
  const byWord = new Map(lessons.map((lesson) => [String(lesson.word).toLowerCase(), lesson]));
  return words.map((item) => {
    const lesson = byWord.get(item.word);
    if (!lesson?.sentence?.toLowerCase().includes(item.word) || !lesson.orderHint || !lesson.translation) throw new Error(`Invalid sentence for ${item.word}`);
    return { word: item.word, sentence: lesson.sentence, orderHint: lesson.orderHint, translation: lesson.translation };
  });
}

async function main() {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from .env.local');
  const source = await readFile(path.join(root, 'public', 'data', '800-words.txt'), 'utf8');
  const words = parseWords(source).slice(0, limit);
  const lessons = [];
  for (let offset = 0; offset < words.length; offset += batchSize) {
    const batch = words.slice(offset, offset + batchSize);
    lessons.push(...await generateBatch(batch, apiKey));
    console.log(`[${Math.min(offset + batch.length, words.length)}/${words.length}] sentence lessons created`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(lessons, null, 2)}\n`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
