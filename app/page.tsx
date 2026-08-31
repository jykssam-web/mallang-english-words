'use client';

import { useEffect, useMemo, useState } from 'react';

type Word = { word: string; meaning: string };
type Stage = 'home' | 'choice' | 'reveal' | 'spelling' | 'result';
type LearningRecord = { exposures: number; spellingStreak: number; mastered: boolean; due: string; failedToday?: boolean };

const DEMO_WORDS: Word[] = [
  { word: 'bird', meaning: '새' }, { word: 'bed', meaning: '침대' },
  { word: 'bee', meaning: '꿀벌, 벌' }, { word: 'cat', meaning: '고양이' },
  { word: 'ship', meaning: '배' }, { word: 'hat', meaning: '모자' },
  { word: 'knife', meaning: '칼, 나이프' }, { word: 'finger', meaning: '손가락' },
  { word: 'music', meaning: '음악' }, { word: 'kitchen', meaning: '주방, 부엌' },
];

const PICTURES: Record<string, string> = {
  bird: '🐦', bed: '🛏️', bee: '🐝', cat: '🐈', ship: '⛵', hat: '🎩',
  knife: '🔪', finger: '☝️', music: '🎵', kitchen: '🍳', police: '👮',
  death: '🥀', fine: '👍', point: '👉', take: '🤲', beef: '🥩', center: '🎯',
  deep: '🌊', happy: '😊', table: '🪑', uncle: '👨', cash: '💵', film: '🎞️',
  kiss: '💋', play: '🛝', seven: '7️⃣', tail: '🐕',
};

const VOWELS = ['a', 'e', 'i', 'o', 'u'];
const SWAPS: Record<string, string> = { b:'d',d:'b',p:'b',f:'v',v:'f',c:'k',k:'c',s:'z',z:'s',g:'j',j:'g',l:'r',r:'l',m:'n',n:'m',t:'d',h:'w',w:'h' };
const LETTER_PAIRS: Record<string, string> = {
  a: 'e', b: 'd', c: 's', d: 'b', e: 'a', f: 'v', g: 'q', h: 'n', i: 'e',
  j: 'g', k: 'x', l: 'r', m: 'n', n: 'm', o: 'u', p: 'b', q: 'g', r: 'l',
  s: 'c', t: 'd', u: 'o', v: 'f', w: 'm', x: 'k', y: 'v', z: 's',
};
const ANSWER_REVEAL_MS = 3000;

function seededShuffle<T>(items: T[], seed: number) {
  const copy = [...items]; let value = seed || 1;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const j = Math.floor((value / 233280) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeDistractors(word: string) {
  const variants = new Set<string>(); const chars = [...word.toLowerCase()];
  chars.forEach((char, index) => {
    if (VOWELS.includes(char)) VOWELS.filter((v) => v !== char).forEach((v) => variants.add(chars.map((c, i) => i === index ? v : c).join('')));
    else if (SWAPS[char]) variants.add(chars.map((c, i) => i === index ? SWAPS[char] : c).join(''));
  });
  if (chars.length > 3) {
    const middle = Math.max(1, Math.floor(chars.length / 2) - 1); const swapped = [...chars];
    [swapped[middle], swapped[middle + 1]] = [swapped[middle + 1], swapped[middle]]; variants.add(swapped.join(''));
  }
  variants.delete(word);
  [`${word}e`, word.slice(0, -1), `${word.slice(0, 1)}${word.slice(2)}`].forEach((item) => item && item !== word && variants.add(item));
  return [...variants].filter((item) => item.length >= 2).slice(0, 3);
}

function makeLetterCards(word: string, seed: number) {
  const cards = [...word.toLowerCase()].flatMap((letter) => [letter, LETTER_PAIRS[letter] ?? 'x']);
  return seededShuffle(cards.map((letter, id) => ({ id, letter })), seed);
}

function speak(word: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US'; utterance.rate = 0.78; utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((item) => /^en-US$/i.test(item.lang) && /(natural|google|samantha|aria|jenny|zira|david)/i.test(item.name))
    ?? voices.find((item) => /^en-US$/i.test(item.lang));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function dateAfter(days: number) {
  const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10);
}

export default function Home() {
  const [allWords, setAllWords] = useState<Word[]>(DEMO_WORDS);
  const [session, setSession] = useState<Word[]>(DEMO_WORDS);
  const [index, setIndex] = useState(0); const [stage, setStage] = useState<Stage>('home');
  const [attempt, setAttempt] = useState(0); const [disabledOptions, setDisabledOptions] = useState<string[]>([]);
  const [selectedLetters, setSelectedLetters] = useState<{ id: number; letter: string }[]>([]);
  const [spellingFails, setSpellingFails] = useState(0); const [retryWords, setRetryWords] = useState<Word[]>([]);
  const [known, setKnown] = useState(0); const [message, setMessage] = useState('소리를 듣고 알맞은 단어를 골라 보세요.');
  const [progress, setProgress] = useState({ exposed: 0, mastered: 0, streak: 1 });
  const [records, setRecords] = useState<Record<string, LearningRecord>>({});

  useEffect(() => {
    fetch('/data/800-words.txt').then((response) => response.text()).then((text) => {
      const parsed = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => /\s/.test(line)).map((line) => {
        const match = line.match(/^(\S+)\s+(.+)$/); return match ? { word: match[1].toLowerCase(), meaning: match[2].trim() } : null;
      }).filter((item): item is Word => Boolean(item));
      if (parsed.length === 800) setAllWords(parsed);
    }).catch(() => undefined);
    queueMicrotask(() => {
      const saved = localStorage.getItem('word-garden-progress'); if (saved) setProgress(JSON.parse(saved));
      const savedRecords = localStorage.getItem('word-garden-records'); if (savedRecords) setRecords(JSON.parse(savedRecords));
    });
  }, []);

  const current = session[index] ?? DEMO_WORDS[0];
  const distractors = useMemo(() => makeDistractors(current.word), [current]);
  const options = useMemo(() => seededShuffle([current.word, ...distractors], current.word.length * 31 + index), [current, distractors, index]);
  const cards = useMemo(() => makeLetterCards(current.word, index * 17 + current.word.length), [current, index]);

  function startLearning() {
    const today = new Date().toISOString().slice(0, 10);
    const due = allWords.filter((item) => records[item.word]?.due <= today);
    const unseen = allWords.filter((item) => !records[item.word]);
    const fallback = allWords.filter((item) => !due.some((dueWord) => dueWord.word === item.word) && !unseen.some((newWord) => newWord.word === item.word));
    const pictureFirst = (items: Word[]) => [...items.filter((item) => PICTURES[item.word]), ...items.filter((item) => !PICTURES[item.word])];
    const pool = [...pictureFirst(due).slice(0, 10), ...pictureFirst(unseen), ...fallback].filter((item, itemIndex, items) => items.findIndex((other) => other.word === item.word) === itemIndex).slice(0, 10);
    setSession(pool.length === 10 ? pool : DEMO_WORDS); setIndex(0); setKnown(0); setRetryWords([]);
    setAttempt(0); setDisabledOptions([]); setSelectedLetters([]); setSpellingFails(0); setMessage('스피커 버튼을 눌러 소리를 듣고 알맞은 단어를 골라 보세요.'); setStage('choice');
  }

  function chooseOption(option: string) {
    if (disabledOptions.includes(option)) return;
    if (option === current.word) {
      if (attempt === 0) setKnown((value) => value + 1);
      setMessage('정답이에요! 이제 철자를 만들어 볼까요?');
      setTimeout(() => { setStage('spelling'); setMessage('각 철자마다 두 장의 카드가 있어요. 순서대로 골라 보세요.'); }, 650); return;
    }
    if (attempt === 0) { setAttempt(1); setDisabledOptions([option]); setMessage('괜찮아요. 스피커 버튼으로 소리를 다시 듣고 한 번 더 골라 보세요.'); }
    else {
      setRetryWords((words) => words.some((item) => item.word === current.word) ? words : [...words, current]);
      setMessage(`정답은 ${current.word}`); setStage('reveal');
      setTimeout(() => { setStage('spelling'); setMessage('각 철자마다 두 장의 카드가 있어요. 순서대로 골라 보세요.'); }, ANSWER_REVEAL_MS);
    }
  }

  function chooseLetter(card: { id: number; letter: string }) {
    if (card.letter !== current.word[selectedLetters.length]) {
      const nextFails = spellingFails + 1; setSpellingFails(nextFails); setSelectedLetters([]);
      if (nextFails >= 5) {
        setRetryWords((words) => words.some((item) => item.word === current.word) ? words : [...words, current]);
        setMessage(`정답은 ${current.word}`); setStage('reveal'); setTimeout(() => nextQuestion(false), ANSWER_REVEAL_MS);
      } else setMessage(`처음부터 다시! ${5 - nextFails}번 더 도전할 수 있어요.`);
      return;
    }
    const next = [...selectedLetters, card]; setSelectedLetters(next);
    if (next.length === current.word.length) { setMessage('멋져요! 철자를 완성했어요.'); setTimeout(() => nextQuestion(true), 650); }
  }

  function nextQuestion(spellingSuccess: boolean) {
    const effectiveRetries = !spellingSuccess && !retryWords.some((item) => item.word === current.word) ? [...retryWords, current] : retryWords;
    const previous = records[current.word] ?? { exposures: 0, spellingStreak: 0, mastered: false, due: dateAfter(1) };
    const nextStreak = spellingSuccess ? previous.spellingStreak + 1 : 0;
    const target = current.word.length >= 3 && current.word.length <= 4 ? 2 : 3;
    const newlyMastered = spellingSuccess && nextStreak >= target;
    const updatedRecord: LearningRecord = {
      exposures: previous.exposures + 1,
      spellingStreak: nextStreak,
      mastered: previous.mastered || newlyMastered,
      due: !spellingSuccess ? dateAfter(1) : (previous.mastered || newlyMastered ? dateAfter(previous.mastered ? 120 : 60) : dateAfter(attempt === 0 ? 4 : 2)),
      failedToday: !spellingSuccess,
    };
    const nextRecords = { ...records, [current.word]: updatedRecord };
    setRecords(nextRecords); localStorage.setItem('word-garden-records', JSON.stringify(nextRecords));
    if (index >= session.length - 1) {
      if (effectiveRetries.length && session.length <= 10) setSession((items) => [...items, ...effectiveRetries]);
      else {
        const nextProgress = { exposed: Object.keys(nextRecords).length, mastered: Object.values(nextRecords).filter((record) => record.mastered).length, streak: progress.streak };
        localStorage.setItem('word-garden-progress', JSON.stringify(nextProgress)); setProgress(nextProgress); setStage('result'); return;
      }
    }
    setIndex((value) => value + 1); setAttempt(0); setDisabledOptions([]); setSelectedLetters([]); setSpellingFails(0);
    setMessage('스피커 버튼을 눌러 소리를 듣고 알맞은 단어를 골라 보세요.'); setStage('choice');
  }

  if (stage === 'home') return (
    <main className="app-shell home-screen">
      <header className="topbar"><div className="brand"><span className="brand-mark">W</span><span>말랑영단어</span></div><button className="parent-button">보호자</button></header>
      <section className="welcome-grid">
        <div className="welcome-copy"><span className="eyebrow">오늘도 한 걸음</span><h1>보고, 듣고,<br/><em>직접 만드는</em> 영단어</h1><p>하루 10개씩 천천히. 어려운 단어는 다시 만나고, 아는 단어는 오래 기억해요.</p><button className="start-button" onClick={startLearning}>오늘 학습 시작 <span>→</span></button></div>
        <div className="today-card"><div className="sun-doodle">☀️</div><span className="card-label">TODAY</span><strong>새 단어 <b>10</b>개</strong><div className="mini-divider"/><span>예상 시간 약 12분</span><div className="book-stack">📘<span>📙</span><i>✏️</i></div></div>
      </section>
      <section className="progress-strip"><div><span>전체 여정</span><strong>{progress.exposed}<small> / 800</small></strong></div><div className="long-progress"><i style={{ width: `${Math.max(2, progress.exposed / 8)}%` }}/></div><div><span>차곡차곡 익힌 단어</span><strong>{progress.mastered}<small>개</small></strong></div><div><span>연속 학습</span><strong>{progress.streak}<small>일</small></strong></div></section>
      <p className="home-note">작은 반복이 큰 자신감을 만들어요.</p>
    </main>
  );

  if (stage === 'result') return (
    <main className="app-shell center-screen"><section className="result-card"><span className="result-burst">★</span><p className="eyebrow">오늘 학습 완료</p><h1>열 단어를 끝까지 해냈어요!</h1><p>한 번에 알아본 단어는 <strong>{known}개</strong>예요.<br/>다시 볼 단어는 다음 학습에 먼저 만나요.</p><button className="start-button" onClick={() => setStage('home')}>홈으로 돌아가기</button></section></main>
  );

  return (
    <main className="app-shell lesson-screen">
      <header className="lesson-header"><button className="round-button" onClick={() => setStage('home')} aria-label="학습 나가기">×</button><div className="lesson-progress"><i style={{ width: `${((index + 1) / session.length) * 100}%` }}/></div><span className="step-count">{Math.min(index + 1, 10)} / {Math.min(session.length, 10)}</span></header>
      <section className="lesson-card">
        <div className="prompt-side"><span className="picture-frame" role="img" aria-label={current.meaning}>{PICTURES[current.word] ?? '🌟'}</span><h1>{current.meaning.split(',')[0]}</h1><button className="speaker-button" onClick={() => speak(current.word)}><span>🔊</span> 소리 듣기</button></div>
        <div className="answer-side"><p className="instruction">{message}</p>
          {stage === 'choice' && <div className="option-grid">{options.map((option) => <button key={option} disabled={disabledOptions.includes(option)} onClick={() => chooseOption(option)} className={disabledOptions.includes(option) ? 'wrong-option' : ''}>{option}</button>)}</div>}
          {stage === 'reveal' && <div className="answer-reveal">{current.word}</div>}
          {stage === 'spelling' && <><div className="built-word">{selectedLetters.map((card) => <span key={card.id}>{card.letter}</span>)}<i/></div><div className="letter-bank">{cards.map((card) => { const used = selectedLetters.some((selected) => selected.id === card.id); return <button key={card.id} disabled={used} onClick={() => chooseLetter(card)}>{card.letter}</button>; })}</div><div className="try-dots">{[0,1,2,3,4].map((dot) => <i key={dot} className={dot < spellingFails ? 'used' : ''}/>)}</div></>}
        </div>
      </section>
      <footer className="lesson-tip">💡 그림과 뜻을 천천히 보고, 소리를 여러 번 들어도 좋아요.</footer>
    </main>
  );
}
