# Because, Therefore

**One-line hook:** Cards Against Causality: rebuild the true because→therefore chain before correlation crashes the party.

Because, Therefore is a fast multiplayer party game about causal reasoning. Players see real historical disasters or absurd chain-reaction events as scrambled cards, then race to rebuild the actual sequence of causes. Each round includes a plausible trap card: a related fact that feels causal but is not.

The built-in playable rounds are:

- The 1919 Boston Molasses Flood
- The 1940 Tacoma Narrows Bridge collapse
- The 1814 London Beer Flood

## How To Run

Requires Node.js 18+ with built-in `fetch`.

```bash
node server.js
```

Open:

```text
http://localhost:3000
```

Fast demo path:

1. Run `node server.js`.
2. Open `http://localhost:3000`.
3. Click `Quick Play / Solo`.
4. Place the scrambled cards into the causal chain.
5. Leave the trap card out.
6. Click `Submit Chain` to trigger the reveal.

## No-Key Behavior

The game runs fully without an API key. Multiplayer rooms, Quick Play, bots, scoring, reveal animations, and the built-in rounds all work offline.

If a player asks for a custom topic without `OPENAI_API_KEY`, the server labels the result as an offline fallback and loads a built-in round so the demo never breaks.

## With-Key Behavior

Set an API key before starting the server:

```bash
OPENAI_API_KEY=your_key_here node server.js
```

Then use the “Make your own round” input with any topic, such as `The Suez Canal blockage` or `The Mars Climate Orbiter`.

## How GPT-5.6 Is Used

The core GPT-powered feature is:

```text
generateRound(topic)
```

When `OPENAI_API_KEY` is set, the server calls model `gpt-5.6` with strict JSON output to turn a player-supplied topic into:

- a round title
- a short blurb
- 6 to 7 true cause-and-effect cards
- one plausible trap card that is related but not actually causal
- explanations for why each link is causal

Any timeout, network error, invalid JSON, or missing key gracefully falls back to a labeled offline round.

## How Codex Was Used

Codex built the core project in this session: the zero-dependency Node server, vanilla client, three hardcoded rounds, deterministic scoring, bot Quick Play, short-polling multiplayer, GPT-5.6 round generation, docs, and verification path.

Key decisions:

- Keep the app dependency-free for reliable judging and easy local demos.
- Use deterministic server-side scoring: exact order, correct adjacencies, trap exclusion, and perfect-chain bonus.
- Treat the trap card as the teaching moment for correlation versus causation.
- Make GPT-5.6 optional so the submission is complete with or without credentials.

## Tech Stack

- Plain Node.js `http` server
- Vanilla HTML, CSS, and JavaScript
- JSON files for built-in rounds
- No npm dependencies
- No build step

## Learning Goal

Because, Therefore teaches causal reasoning by making players distinguish “this happened near the event” from “this caused the next step.” The reveal turns the answer into an aha-cascade: each card snaps into the true chain and explains why the link matters.
