import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, 'public', 'audio', 'words');
const onlyWord = process.argv[2]?.toLowerCase();

function getApiKey() {
  const envText = process.env.GEMINI_API_KEY ? '' : readFile(path.join(root, '.env.local'), 'utf8');
  return Promise.resolve(envText).then((text) => process.env.GEMINI_API_KEY ?? text.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, ''));
}

function wordFileName(word) {
  return `${word.toLowerCase().replace(/[^a-z0-9-]/g, '_')}.wav`;
}

function pcmToWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function findAudioData(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'audio' && typeof value.data === 'string') return value.data;
  for (const child of Object.values(value)) {
    const audio = findAudioData(child);
    if (audio) return audio;
  }
  return null;
}

async function createAudio(word, apiKey) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.1-flash-tts-preview',
      input: `Say only the English word "${word}" once. Use a clear, neutral American English pronunciation for a young learner. Carefully articulate every sound.`,
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: 'Iapetus' }] },
    }),
  });
  if (!response.ok) throw new Error(`Gemini TTS request failed (${response.status})`);
  const payload = await response.json();
  const encodedAudio = payload?.output_audio?.data ?? findAudioData(payload?.steps);
  if (!encodedAudio) throw new Error('Gemini TTS returned no audio data');
  return pcmToWav(Buffer.from(encodedAudio, 'base64'));
}

async function main() {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from .env.local');
  const source = await readFile(path.join(root, 'public', 'data', '800-words.txt'), 'utf8');
  const words = source.split(/\r?\n/).map((line) => line.trim().match(/^(\S+)\s+/)?.[1]?.toLowerCase()).filter(Boolean);
  const targets = onlyWord ? words.filter((word) => word === onlyWord) : [...new Set(words)];
  if (!targets.length) throw new Error(`No matching word found: ${onlyWord}`);
  await mkdir(outputDir, { recursive: true });
  for (const [index, word] of targets.entries()) {
    const destination = path.join(outputDir, wordFileName(word));
    try { await stat(destination); console.log(`[${index + 1}/${targets.length}] exists: ${word}`); continue; } catch { /* create it */ }
    const audio = await createAudio(word, apiKey);
    await writeFile(destination, audio);
    console.log(`[${index + 1}/${targets.length}] created: ${word}`);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
