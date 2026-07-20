#!/usr/bin/env node
/**
 * Because, Therefore
 * Zero-dependency Node server. Run: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROUNDS_DIR = path.join(__dirname, 'rounds');
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = 'gpt-5.6';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const BOT_NAMES = ['Dr. Domino', 'Professor Oops', 'Captain Correlation'];
const roomStore = new Map();

const preferredRoundOrder = ['molasses-flood.json', 'tacoma-narrows.json', 'london-beer-flood.json'];
const roundFiles = fs.readdirSync(ROUNDS_DIR)
  .filter(file => file.endsWith('.json'))
  .sort((a, b) => {
    const ai = preferredRoundOrder.indexOf(a);
    const bi = preferredRoundOrder.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });
const builtInRounds = roundFiles.map(file => normalizeRound(
  JSON.parse(fs.readFileSync(path.join(ROUNDS_DIR, file), 'utf8')),
  path.basename(file, '.json')
));

if (!builtInRounds.length) {
  throw new Error('No built-in rounds found in rounds/');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return Date.now();
}

function cleanString(value, fallback, limit) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, limit);
}

function slug(value, fallback) {
  return cleanString(value, fallback || 'item', 90)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || fallback || 'item';
}

function shortCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) code += chars[crypto.randomInt(chars.length)];
  return roomStore.has(code) ? shortCode() : code;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 120000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeRound(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') throw new Error('Round must be an object');
  if (!Array.isArray(raw.cards) || raw.cards.length < 5 || raw.cards.length > 8) {
    throw new Error('Round needs 5 to 8 true causal cards');
  }
  const seen = new Set();
  const cards = raw.cards.map((card, index) => {
    const id = slug(card && card.id, `card-${index + 1}`);
    if (seen.has(id)) throw new Error('Round card ids must be unique');
    seen.add(id);
    return {
      id,
      text: cleanString(card && card.text, `Cause card ${index + 1}`, 220),
      order: Number.isInteger(Number(card && card.order)) ? Number(card.order) : index,
      why: cleanString(card && card.why, 'This link pushes the next event in the chain.', 360)
    };
  }).sort((a, b) => a.order - b.order);
  cards.forEach((card, index) => {
    card.order = index;
  });
  const trapId = slug(raw.trap && raw.trap.id, 'trap-card');
  return {
    id: slug(raw.id || fallbackId || raw.title, fallbackId || 'round'),
    title: cleanString(raw.title, 'Untitled Chain Reaction', 120),
    blurb: cleanString(raw.blurb, 'Rebuild the true because-therefore chain.', 420),
    signatureLine: cleanString(raw.signatureLine, 'Correlation showed up wearing a fake mustache.', 140),
    cards,
    trap: {
      id: trapId,
      text: cleanString(raw.trap && raw.trap.text, 'A plausible detail that did not cause the chain.', 220),
      whyNotCause: cleanString(raw.trap && raw.trap.whyNotCause, 'It is related context, but it does not drive the causal chain.', 360)
    },
    source: raw.source || 'built-in'
  };
}

function publicRound(round, reveal) {
  const cards = round.cards.map(card => ({
    id: card.id,
    text: card.text
  })).concat([{
    id: round.trap.id,
    text: round.trap.text
  }]);
  return {
    id: round.id,
    title: round.title,
    blurb: round.blurb,
    signatureLine: round.signatureLine,
    chainLength: round.cards.length,
    cards: stableShuffle(cards, round.id + ':cards'),
    source: round.source,
    solution: reveal ? round.cards.map(card => ({
      id: card.id,
      text: card.text,
      order: card.order,
      why: card.why
    })) : null,
    trap: reveal ? {
      id: round.trap.id,
      text: round.trap.text,
      whyNotCause: round.trap.whyNotCause
    } : null
  };
}

function stableShuffle(items, seed) {
  const list = clone(items);
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) {
    state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  }
  for (let i = list.length - 1; i > 0; i -= 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const j = state % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function getRoundByIndex(index) {
  return clone(builtInRounds[Math.abs(index) % builtInRounds.length]);
}

function scoreChain(round, chain) {
  const expected = new Map(round.cards.map(card => [card.id, card.order]));
  const selected = Array.isArray(chain) ? chain.slice(0, round.cards.length).map(String) : [];
  const unique = new Set(selected);
  let correctPositions = 0;
  let correctAdjacencies = 0;
  let trapUsed = false;
  const slotResults = [];
  const adjacencyResults = [];

  for (let i = 0; i < round.cards.length; i += 1) {
    const id = selected[i] || '';
    const isTrap = id === round.trap.id;
    const expectedOrder = expected.has(id) ? expected.get(id) : -1;
    const correct = expectedOrder === i;
    if (isTrap) trapUsed = true;
    if (correct) correctPositions += 1;
    slotResults.push({
      slot: i,
      cardId: id,
      correct,
      isTrap,
      expectedOrder
    });
  }

  for (let i = 0; i < selected.length - 1; i += 1) {
    const left = expected.get(selected[i]);
    const right = expected.get(selected[i + 1]);
    const correct = Number.isInteger(left) && right === left + 1;
    if (correct) correctAdjacencies += 1;
    adjacencyResults.push({ afterSlot: i, correct });
  }

  const duplicatePenalty = unique.size < selected.length ? (selected.length - unique.size) * 10 : 0;
  const missingPenalty = selected.length < round.cards.length ? (round.cards.length - selected.length) * 12 : 0;
  const trapBonus = trapUsed ? -20 : 25;
  const perfect = correctPositions === round.cards.length && correctAdjacencies === round.cards.length - 1 && !trapUsed;
  const perfectBonus = perfect ? 20 : 0;
  const score = Math.max(0,
    correctPositions * 10 +
    correctAdjacencies * 8 +
    trapBonus +
    perfectBonus -
    duplicatePenalty -
    missingPenalty
  );

  return {
    score,
    correctPositions,
    correctAdjacencies,
    trapExcluded: !trapUsed,
    trapPenalty: trapUsed ? -20 : 0,
    duplicatePenalty,
    missingPenalty,
    perfect,
    slotResults,
    adjacencyResults
  };
}

function publicPlayer(player, submission) {
  return {
    id: player.id,
    name: player.name,
    isBot: !!player.isBot,
    joinedAt: player.joinedAt,
    submitted: !!submission,
    score: submission ? submission.score.score : player.totalScore || 0,
    totalScore: player.totalScore || 0
  };
}

function publicRoom(room) {
  const reveal = room.phase === 'REVEAL';
  const scores = room.players.map(player => {
    const submission = room.submissions[player.id];
    return publicPlayer(player, submission);
  }).sort((a, b) => (b.score - a.score) || a.joinedAt - b.joinedAt);
  return {
    code: room.code,
    phase: room.phase,
    createdAt: room.createdAt,
    roundStartedAt: room.roundStartedAt,
    players: room.players.map(player => publicPlayer(player, room.submissions[player.id])),
    scoreboard: scores,
    round: room.round ? publicRound(room.round, reveal) : null,
    reveal: reveal ? {
      submissions: Object.fromEntries(Object.entries(room.submissions).map(([id, sub]) => [id, {
        chain: sub.chain,
        score: sub.score
      }]))
    } : null
  };
}

function createPlayer(name, isBot) {
  return {
    id: crypto.randomUUID(),
    name: cleanString(name, isBot ? 'Bot' : 'Player', 32),
    isBot: !!isBot,
    joinedAt: now(),
    totalScore: 0
  };
}

function createRoom(hostName, quickPlay) {
  const code = shortCode();
  const host = createPlayer(hostName || 'Host', false);
  const room = {
    code,
    phase: 'LOBBY',
    createdAt: now(),
    roundStartedAt: null,
    nextRoundIndex: 0,
    players: [host],
    round: null,
    submissions: {}
  };
  if (quickPlay) {
    BOT_NAMES.forEach(name => room.players.push(createPlayer(name, true)));
    startRound(room, getRoundByIndex(0));
  }
  roomStore.set(code, room);
  return { room, playerId: host.id };
}

function startRound(room, round) {
  room.phase = 'ROUND';
  room.round = normalizeRound(round, round && round.id);
  room.roundStartedAt = now();
  room.submissions = {};
}

function botChain(round, botIndex) {
  const chain = round.cards.map(card => card.id);
  if (botIndex === 0) {
    [chain[2], chain[3]] = [chain[3], chain[2]];
  } else if (botIndex === 1) {
    chain[round.cards.length - 1] = round.trap.id;
  } else {
    [chain[0], chain[1]] = [chain[1], chain[0]];
    [chain[4], chain[5]] = [chain[5], chain[4]];
  }
  return chain;
}

function submitChain(room, playerId, chain) {
  if (!room.round) throw new Error('No active round');
  const player = room.players.find(item => item.id === playerId);
  if (!player) throw new Error('Unknown player');
  const cleanChain = Array.isArray(chain) ? chain.slice(0, room.round.cards.length).map(String) : [];
  const scored = scoreChain(room.round, cleanChain);
  room.submissions[playerId] = {
    playerId,
    chain: cleanChain,
    score: scored,
    submittedAt: now()
  };
  player.totalScore = scored.score;
  return room.submissions[playerId];
}

function submitBots(room) {
  const bots = room.players.filter(player => player.isBot);
  bots.forEach((bot, index) => {
    if (!room.submissions[bot.id]) {
      submitChain(room, bot.id, botChain(room.round, index));
    }
  });
}

function maybeReveal(room) {
  if (room.players.every(player => room.submissions[player.id])) {
    room.phase = 'REVEAL';
  }
}

const roundSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'blurb', 'cards', 'trap'],
  properties: {
    title: { type: 'string' },
    blurb: { type: 'string' },
    cards: {
      type: 'array',
      minItems: 6,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'order', 'why'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          order: { type: 'integer' },
          why: { type: 'string' }
        }
      }
    },
    trap: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'text', 'whyNotCause'],
      properties: {
        id: { type: 'string' },
        text: { type: 'string' },
        whyNotCause: { type: 'string' }
      }
    }
  }
};

async function openAIJSON(name, system, user, schema, timeoutMs) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY is not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 16000);
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + API_KEY
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name, strict: true, schema }
        },
        max_completion_tokens: 1800
      })
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 240)}`);
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('OpenAI returned no JSON content');
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}

async function generateRound(topic) {
  const safeTopic = cleanString(topic, 'a surprising real chain-reaction event', 120);
  try {
    const raw = await openAIJSON(
      'because_therefore_round',
      'You generate compact, factual party-game rounds about real historical disasters or absurd chain-reaction events. Return only strict JSON. The cards must form one true because->therefore chain. The trap must be plausible and related, but not an actual cause. Keep tone witty, not cruel.',
      `Create a Because, Therefore round about: ${safeTopic}. Use 6 or 7 causal cards. Every card needs a clear causal explanation in "why". The trap should teach correlation-vs-causation.`,
      roundSchema,
      16000
    );
    const round = normalizeRound({
      id: slug(safeTopic, 'generated-round'),
      title: raw.title,
      blurb: raw.blurb,
      signatureLine: 'Correlation is invited, but it has to sit in the trap pile.',
      cards: raw.cards,
      trap: raw.trap,
      source: 'gpt-5.6'
    }, slug(safeTopic, 'generated-round'));
    return { round, generated: true, fallback: false };
  } catch (err) {
    console.warn(`[because-therefore] generateRound fallback: ${err.message}`);
    const index = Math.abs(Buffer.from(safeTopic).reduce((sum, byte) => sum + byte, 0)) % builtInRounds.length;
    const round = getRoundByIndex(index);
    round.source = API_KEY ? 'offline-fallback-after-api-error' : 'offline-fallback-no-key';
    return { round, generated: false, fallback: true, error: err.message };
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

async function handleAPI(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        app: 'Because, Therefore',
        rooms: roomStore.size,
        rounds: builtInRounds.length,
        apiKeyConfigured: !!API_KEY,
        model: MODEL
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/rounds') {
      return json(res, 200, {
        rounds: builtInRounds.map(round => ({
          id: round.id,
          title: round.title,
          blurb: round.blurb
        }))
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      const body = await parseBody(req);
      const created = createRoom(body.name, !!body.quickPlay);
      return json(res, 200, { playerId: created.playerId, room: publicRoom(created.room) });
    }

    if (parts[0] === 'api' && parts[1] === 'rooms' && parts[2]) {
      const code = parts[2].toUpperCase();
      const room = roomStore.get(code);
      if (!room) return json(res, 404, { error: 'Room not found' });

      if (req.method === 'GET' && parts.length === 3) {
        return json(res, 200, { room: publicRoom(room) });
      }

      if (req.method === 'POST' && parts[3] === 'join') {
        const body = await parseBody(req);
        if (room.phase !== 'LOBBY') return json(res, 409, { error: 'Round already started' });
        if (room.players.length >= 8) return json(res, 409, { error: 'Room is full' });
        const player = createPlayer(body.name, false);
        room.players.push(player);
        return json(res, 200, { playerId: player.id, room: publicRoom(room) });
      }

      if (req.method === 'POST' && parts[3] === 'start') {
        const body = await parseBody(req);
        if (body.topic) {
          const result = await generateRound(body.topic);
          startRound(room, result.round);
        } else {
          startRound(room, getRoundByIndex(room.nextRoundIndex));
          room.nextRoundIndex += 1;
        }
        return json(res, 200, { room: publicRoom(room) });
      }

      if (req.method === 'POST' && parts[3] === 'custom-round') {
        const body = await parseBody(req);
        const result = await generateRound(body.topic);
        startRound(room, result.round);
        return json(res, 200, {
          generated: result.generated,
          fallback: result.fallback,
          error: result.fallback ? result.error : null,
          room: publicRoom(room)
        });
      }

      if (req.method === 'POST' && parts[3] === 'submit') {
        const body = await parseBody(req);
        const playerId = cleanString(body.playerId, '', 80);
        if (room.phase !== 'ROUND') return json(res, 409, { error: 'Room is not accepting submissions' });
        const submission = submitChain(room, playerId, body.chain);
        submitBots(room);
        maybeReveal(room);
        return json(res, 200, { submission, room: publicRoom(room) });
      }

      if (req.method === 'POST' && parts[3] === 'reveal') {
        submitBots(room);
        room.phase = 'REVEAL';
        return json(res, 200, { room: publicRoom(room) });
      }
    }

    return json(res, 404, { error: 'API route not found' });
  } catch (err) {
    return json(res, 500, { error: err.message || 'Server error' });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    handleAPI(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Because, Therefore running at http://localhost:${PORT}`);
  console.log(API_KEY ? `GPT round generation enabled with ${MODEL}` : 'No OPENAI_API_KEY set; using offline rounds.');
});
