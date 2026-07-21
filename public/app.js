const app = document.getElementById('app');
const roomPill = document.getElementById('roomPill');
const lobbyTemplate = document.getElementById('lobbyTemplate');
const waitingTemplate = document.getElementById('waitingTemplate');

const state = {
  playerId: localStorage.getItem('btPlayerId') || '',
  roomCode: localStorage.getItem('btRoomCode') || '',
  room: null,
  selectedId: null,
  chain: [],
  lastPhase: '',
  lastRoundId: '',
  busy: false,
  message: '',
  error: ''
};

let pollTimer = null;

function escapeHTML(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function playerName() {
  const saved = localStorage.getItem('btPlayerName') || '';
  const input = document.getElementById('playerName');
  const value = (input && input.value.trim()) || saved || 'Player';
  localStorage.setItem('btPlayerName', value);
  return value;
}

function setRoom(room, playerId) {
  state.room = room;
  state.roomCode = room ? room.code : '';
  if (playerId) state.playerId = playerId;
  if (state.roomCode) localStorage.setItem('btRoomCode', state.roomCode);
  if (state.playerId) localStorage.setItem('btPlayerId', state.playerId);
  const roundChanged = room && room.round && room.round.id !== state.lastRoundId;
  if (room && (room.phase !== state.lastPhase || roundChanged)) {
    state.selectedId = null;
    if (room.round) {
      const previous = room.reveal && room.reveal.submissions[state.playerId];
      state.chain = previous ? previous.chain.slice() : Array(room.round.chainLength).fill(null);
      state.lastRoundId = room.round.id;
    }
    state.lastPhase = room.phase;
  }
  render();
  startPolling();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (!state.roomCode) return;
  pollTimer = setInterval(async () => {
    try {
      const data = await api(`/api/rooms/${state.roomCode}`);
      setRoom(data.room);
    } catch (err) {
      state.error = err.message;
      render();
    }
  }, 1200);
}

function toast(text) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 1800);
}

async function createRoom(quickPlay, topic) {
  state.busy = true;
  state.error = '';
  render();
  try {
    const data = await api('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: playerName(), quickPlay })
    });
    setRoom(data.room, data.playerId);
    if (topic && data.room.phase === 'ROUND') {
      await customRound(topic);
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function joinRoom() {
  const code = (document.getElementById('roomCodeInput').value || '').trim().toUpperCase();
  if (!code) return;
  state.busy = true;
  state.error = '';
  render();
  try {
    const data = await api(`/api/rooms/${code}/join`, {
      method: 'POST',
      body: JSON.stringify({ name: playerName() })
    });
    setRoom(data.room, data.playerId);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function startRound(topic) {
  state.busy = true;
  state.error = '';
  render();
  try {
    const data = await api(`/api/rooms/${state.roomCode}/start`, {
      method: 'POST',
      body: JSON.stringify({ topic: topic || '' })
    });
    state.message = '';
    setRoom(data.room);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function customRound(topic) {
  const safeTopic = (topic || '').trim();
  if (!safeTopic) return;
  if (!state.roomCode) {
    await createRoom(true, safeTopic);
    return;
  }
  state.busy = true;
  state.error = '';
  state.message = 'Generating round...';
  render();
  try {
    const data = await api(`/api/rooms/${state.roomCode}/custom-round`, {
      method: 'POST',
      body: JSON.stringify({ topic: safeTopic })
    });
    state.message = data.fallback
      ? (data.message || 'Offline mode - using a built-in round. GPT-5.6 generation is available with a key.')
      : 'GPT-5.6 generated a fresh chain.';
    setRoom(data.room);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

function setupLobby() {
  const saved = localStorage.getItem('btPlayerName') || '';
  const nameInput = document.getElementById('playerName');
  nameInput.value = saved;
  document.getElementById('quickPlayBtn').addEventListener('click', () => createRoom(true));
  document.getElementById('createRoomBtn').addEventListener('click', () => createRoom(false));
  document.getElementById('joinRoomBtn').addEventListener('click', joinRoom);
  document.getElementById('roomCodeInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') joinRoom();
  });
  document.getElementById('topicQuickBtn').addEventListener('click', () => {
    customRound(document.getElementById('topicInput').value);
  });
  document.getElementById('topicInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') customRound(event.currentTarget.value);
  });
}

function renderLobby() {
  roomPill.textContent = 'No room yet';
  app.innerHTML = '';
  app.appendChild(lobbyTemplate.content.cloneNode(true));
  setupLobby();
  renderStatus();
}

function renderWaiting() {
  roomPill.textContent = `Room ${state.room.code}`;
  app.innerHTML = '';
  app.appendChild(waitingTemplate.content.cloneNode(true));
  app.querySelector('[data-room-code]').textContent = state.room.code;
  document.getElementById('playerList').innerHTML = state.room.players.map(player => `
    <div class="player">
      <strong>${escapeHTML(player.name)}</strong>
      <span class="badge">${player.isBot ? 'bot' : 'ready'}</span>
    </div>
  `).join('');
  document.getElementById('startRoundBtn').addEventListener('click', () => startRound());
  document.getElementById('copyCodeBtn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(state.room.code).catch(() => {});
    toast(`Copied ${state.room.code}`);
  });
  document.getElementById('lobbyTopicBtn').addEventListener('click', () => {
    customRound(document.getElementById('lobbyTopicInput').value);
  });
  renderStatus();
}

function cardById(id) {
  return state.room.round.cards.find(card => card.id === id);
}

function placeSelected(slot) {
  if (!state.selectedId) return;
  const existing = state.chain.indexOf(state.selectedId);
  if (existing !== -1) state.chain[existing] = null;
  state.chain[slot] = state.selectedId;
  state.selectedId = null;
  render();
}

function removeSlot(slot) {
  if (state.room.phase !== 'ROUND') return;
  state.chain[slot] = null;
  render();
}

function selectCard(id) {
  state.selectedId = state.selectedId === id ? null : id;
  render();
}

function wireDragAndDrop() {
  app.querySelectorAll('[draggable="true"]').forEach(node => {
    node.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', node.dataset.cardId);
      state.selectedId = node.dataset.cardId;
    });
  });
  app.querySelectorAll('.chain-slot').forEach(slot => {
    slot.addEventListener('dragover', event => {
      event.preventDefault();
      slot.classList.add('over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('over'));
    slot.addEventListener('drop', event => {
      event.preventDefault();
      slot.classList.remove('over');
      const id = event.dataTransfer.getData('text/plain');
      state.selectedId = id;
      placeSelected(Number(slot.dataset.slot));
    });
  });
}

async function submitChain() {
  if (state.chain.some(id => !id)) {
    state.error = 'Fill every slot first. Leave the trap in the evidence pile.';
    render();
    return;
  }
  state.busy = true;
  state.error = '';
  render();
  try {
    const data = await api(`/api/rooms/${state.roomCode}/submit`, {
      method: 'POST',
      body: JSON.stringify({ playerId: state.playerId, chain: state.chain })
    });
    setRoom(data.room);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function revealNow() {
  state.busy = true;
  state.error = '';
  render();
  try {
    const data = await api(`/api/rooms/${state.roomCode}/reveal`, { method: 'POST', body: '{}' });
    setRoom(data.room);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

function renderEvidence(round) {
  const available = round.cards.filter(card => !state.chain.includes(card.id));
  if (!available.length) {
    return '<p class="hint">Evidence pile empty. If you used the trap, history is side-eyeing you.</p>';
  }
  return available.map(card => `
    <article class="cause-card ${state.selectedId === card.id ? 'selected' : ''}"
      role="button" tabindex="0" draggable="true" data-card-id="${escapeHTML(card.id)}">
      ${escapeHTML(card.text)}
    </article>
  `).join('');
}

function renderChain(round) {
  return state.chain.map((id, index) => {
    const card = id ? cardById(id) : null;
    const connector = index === 0 ? '' : '<div class="connector">therefore</div>';
    const slot = `
      <div class="chain-slot" data-slot="${index}">
        ${card ? `
          <article class="slot-card" role="button" tabindex="0" data-remove-slot="${index}">
            ${escapeHTML(card.text)}
          </article>
        ` : `
          <div class="empty-slot" data-place-slot="${index}">Slot ${index + 1}</div>
        `}
      </div>
    `;
    return connector + slot;
  }).join('');
}

function renderScoreboard() {
  const rows = state.room.scoreboard.map((player, index) => `
    <div class="score-row ${index === 0 && player.submitted ? 'leader' : ''}">
      <div>
        <strong>${escapeHTML(player.name)}</strong>
        <div class="hint">${player.submitted ? 'submitted' : 'thinking'}</div>
      </div>
      <span class="badge">${player.submitted ? player.score + ' pts' : '...'}</span>
    </div>
  `).join('');
  return `
    <aside class="panel">
      <h2>Scoreboard</h2>
      <div class="score-list">${rows}</div>
      <div class="mini-form">
        <input id="roundTopicInput" maxlength="120" placeholder="New round topic">
        <button class="hot" id="roundTopicBtn">Generate Round</button>
      </div>
    </aside>
  `;
}

function sourceLabel(source) {
  if (source === 'gpt-5.6') return 'Generated by GPT-5.6';
  if (source === 'offline-mode') return 'Offline mode';
  if (source === 'offline-fallback') return 'Offline fallback';
  return 'Built-in round';
}

function sourceNote(source) {
  if (source === 'offline-mode') {
    return 'Offline mode - using built-in rounds. GPT-5.6 generation is available with OPENAI_API_KEY.';
  }
  if (source === 'offline-fallback') {
    return 'Generation fell back to a built-in round, so play continues.';
  }
  return '';
}

function renderReveal(round) {
  const mine = state.room.reveal && state.room.reveal.submissions[state.playerId];
  const score = mine ? mine.score : null;
  const solution = round.solution.map((card, index) => `
    <article class="solution-card" style="--delay:${index * 95}ms">
      <strong>${index + 1}</strong>${escapeHTML(card.text)}
      <p class="why">Because: ${escapeHTML(card.why)}</p>
    </article>
  `).join('');
  return `
    <section class="reveal-block">
      <div class="panel-kicker">Aha cascade</div>
      <h2>${score ? `${score.score} points` : 'The true chain'}</h2>
      ${score ? `
        <p class="lead">
          ${score.correctPositions}/${round.chainLength} exact slots ·
          ${score.correctAdjacencies}/${round.chainLength - 1} causal adjacencies ·
          ${score.trapExcluded ? 'trap excluded' : 'trap bit you'}
        </p>
      ` : ''}
      <div class="solution-chain">${solution}</div>
      <div class="trap-lesson">
        <h3>Trap card: ${escapeHTML(round.trap.text)}</h3>
        <p>${escapeHTML(round.trap.whyNotCause)}</p>
      </div>
      <div class="round-actions">
        <button class="primary" id="nextBuiltInBtn">Next Built-In Round</button>
        <button id="backLobbyBtn">Leave Room</button>
      </div>
    </section>
  `;
}

function renderRound() {
  const room = state.room;
  const round = room.round;
  roomPill.textContent = `Room ${room.code}`;
  if (!state.chain.length || state.chain.length !== round.chainLength) {
    state.chain = Array(round.chainLength).fill(null);
  }
  const submitted = room.players.find(player => player.id === state.playerId && player.submitted);
  const isReveal = room.phase === 'REVEAL';
  const note = sourceNote(round.source);
  app.innerHTML = `
    <div class="game-layout">
      <section class="panel">
        <div class="round-title">
          <div>
            <div class="panel-kicker">Because → Therefore</div>
            <h2>${escapeHTML(round.title)}</h2>
            <p class="lead">${escapeHTML(round.blurb)}</p>
          </div>
          <span class="source-badge ${round.source === 'offline-mode' ? 'offline' : ''}">${escapeHTML(sourceLabel(round.source))}</span>
        </div>
        ${note ? `<p class="offline-note">${escapeHTML(note)}</p>` : ''}
        ${isReveal ? renderReveal(round) : `
          <div class="game-board">
            <section>
              <div class="zone-title">
                <span>Scrambled evidence</span>
                <span class="badge">${round.cards.length} cards</span>
              </div>
              <div class="card-pile">${renderEvidence(round)}</div>
            </section>
            <section>
              <div class="zone-title">
                <span>Your causal chain</span>
                <span class="badge">${state.chain.filter(Boolean).length}/${round.chainLength}</span>
              </div>
              <div class="chain-slots">${renderChain(round)}</div>
            </section>
          </div>
          <div class="round-actions">
            <button class="primary" id="submitBtn" ${submitted || state.busy ? 'disabled' : ''}>Submit Chain</button>
            <button id="revealBtn" ${state.busy ? 'disabled' : ''}>Reveal Now</button>
            <span class="status-line">${escapeHTML(round.signatureLine)}</span>
          </div>
        `}
        ${state.message ? `<p class="status-line">${escapeHTML(state.message)}</p>` : ''}
        ${state.error ? `<p class="status-line error">${escapeHTML(state.error)}</p>` : ''}
      </section>
      ${renderScoreboard()}
    </div>
  `;

  if (!isReveal) {
    app.querySelectorAll('.cause-card').forEach(node => {
      node.addEventListener('click', () => selectCard(node.dataset.cardId));
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') selectCard(node.dataset.cardId);
      });
    });
    app.querySelectorAll('[data-place-slot]').forEach(node => {
      node.addEventListener('click', () => placeSelected(Number(node.dataset.placeSlot)));
    });
    app.querySelectorAll('[data-remove-slot]').forEach(node => {
      node.addEventListener('click', () => removeSlot(Number(node.dataset.removeSlot)));
    });
    document.getElementById('submitBtn').addEventListener('click', submitChain);
    document.getElementById('revealBtn').addEventListener('click', revealNow);
    wireDragAndDrop();
  } else {
    document.getElementById('nextBuiltInBtn').addEventListener('click', () => startRound());
    document.getElementById('backLobbyBtn').addEventListener('click', () => {
      localStorage.removeItem('btRoomCode');
      state.room = null;
      state.roomCode = '';
      state.chain = [];
      render();
    });
  }

  document.getElementById('roundTopicBtn').addEventListener('click', () => {
    customRound(document.getElementById('roundTopicInput').value);
  });
}

function renderStatus() {
  if (!state.error && !state.message) return;
  const node = document.createElement('p');
  node.className = `status-line ${state.error ? 'error' : ''}`;
  node.textContent = state.error || state.message;
  app.appendChild(node);
}

function render() {
  if (!state.room) {
    renderLobby();
  } else if (state.room.phase === 'LOBBY') {
    renderWaiting();
  } else {
    renderRound();
  }
}

async function resume() {
  if (!state.roomCode) {
    render();
    return;
  }
  try {
    const data = await api(`/api/rooms/${state.roomCode}`);
    setRoom(data.room);
  } catch (err) {
    localStorage.removeItem('btRoomCode');
    state.roomCode = '';
    state.room = null;
    render();
  }
}

resume();
