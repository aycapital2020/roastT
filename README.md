# Roast Room

![The Roast Room](docs/room.jpg)

Bring a hard business decision and a council of AI advisors argues it out, then hands you a scored verdict and a one-click PDF. Twelve advisors ship with it, each built from that person's public work: their letters, essays, talks, and videos. Type your decision into the box, watch the council argue it out live around a table, then read the verdict and download the PDF. Every seat and the Chair run on xAI Grok through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), and the whole thing deploys to Vercel as a static page plus three small functions.

This is a fork of [nateherkai/roast-room](https://github.com/nateherkai/roast-room) (MIT), reworked to run as a hosted web app on Grok.

| Seat | Pillar | The question they own |
|---|---|---|
| Jeff Bezos | Strategy and decisions | Is this the right bet, and how reversible is it? |
| Paul Graham | Product and startups | Do people actually want this, and is it growing? |
| Alex Hormozi | Offers, pricing, and sales | Will people pay, how much, and how do we close? |
| Gary Vaynerchuk | Marketing and attention | Where does the attention come from? |
| Dan Martell | People, hiring, and founder time | Who does this, and what does it cost your calendar? |
| Gino Wickman | Operations and scaling | Can the business run this without you holding it together? |
| Warren Buffett | Money and capital | What does it do to cash, risk, and long-term value? |

Those seven are the **default board**. Five more advisors are on call, and the Chair brings them in when your question is in their lane:

| Seat | Pillar | The question they own |
|---|---|---|
| Naval Ravikant | Leverage and wealth | Does this build leverage and equity you own, or does it just rent out your time? |
| Codie Sanchez | Buying and owning small businesses | Should you build this, or buy something that already works? |
| Leila Hormozi | Leadership and scaling teams | Can your team and your leadership carry this, and who has to change? |
| Sara Blakely | Consumer product and brand from zero | Will customers love it enough to sell it for you, without outside money? |
| Elon Musk | First principles and execution speed | What is the real constraint here, and can we cut steps and build it faster? |

## What to put in your question

The council is only as good as what you give it. Include:

- **The decision** in one line.
- **Your options.** Two or three. "Keep doing what I do now" counts.
- **Your numbers.** Revenue, cash, and team size.
- **Your limits.** Deadline, hours, and budget.
- **What success looks like**, and by when.
- **Which way you're leaning**, and why. The council tests your lean instead of agreeing with it.

Left something out? The Chair writes down what it had to assume, and the seats challenge it. Click **How it works** in the app for an example you can drop straight into the box.

## Choose who sits at the table

Under the question box:

- **Full council** (5 to 7 seats, 3 rounds) or **Quick** (4 seats, 2 rounds; the vote round is skipped when the seats already agree and nobody flags ruin risk). Quick is about half the model calls.
- **Chair picks**: the Chair reads your question and seats the best fit from all twelve advisors, always keeping one seat that guards your downside and one likely to disagree.
- **Default board**: your usual seven (set in `council/roster.json`, `"default"`).
- **Choose seats**: tick 3 to 9 advisors yourself.

Your choice is remembered in the browser. `"board"` in `council/roster.json` sets what a first-time visitor sees: `"ask"` or `"auto"` start on Chair picks, `"default"` starts on the default board.

## Watch an example first

Open **Examples** at the bottom of the Chats sidebar. Three finished councils ship with the repo, so you can replay them and download their PDFs without making a single model call.

## Chats sidebar

The sidebar on the left works like a chat app: **New chat** gives you a fresh question box, and every council you run is listed under Today, Yesterday, Previous 7 days, or Older. Click one to replay it with its verdict, or use its buttons to download the PDF, rename it, or delete it.

- The lock in the sidebar header pins it open. Unlock it and it folds into a slim rail that slides out when you hover or click, then tucks away after you pick something. Your choice is remembered.
- On a phone, the menu button at the top opens it as a drawer. Tap outside or swipe it left to close it.

## Listen to the council

Press **Listen** at the top and every advisor reads their lines aloud as the debate plays, live or in a replayed example. Each seat has its own voice and the Chair has another. It uses your browser's built-in speech (the Web Speech API), so there is no paid text-to-speech and no extra key. Voices depend on your browser and OS; with only one or two installed, seats still sound different through pitch and pace.

- Lines are queued, so two advisors never talk over each other, and the playback speed also speeds up the voices.
- **Mute** silences the room without turning Listen off. **Skip speaker** moves on to the next line. **Skip ahead** jumps to the end.
- The speaker button on any line in Key points plays just that turn, even with Listen off.
- Your Listen choice is remembered in this browser. Browsers only allow sound after a click, so the voices start once you press Convene or open a chat from the sidebar.

## How it works

- **The browser runs the council.** A full council is a few dozen short calls, so instead of one long server job the page orchestrates it: one call to the Chair for setup, one per seat per round, one each for cruxes, the draft, and the verdict. Every call is its own small function request (`/api/chair`, `/api/seat`), so nothing hits a function time limit, and a failed call is retried on its own.
- **Each seat** gets a system prompt built from its brain (`council/brains/<name>/`: frameworks, principles, positions, stories, and voice notes compiled from public sources, every quote tied to a source) and its persona (`council/agents/council-<name>.md`). Quotes a seat makes are checked against the brain on the server and marked verified or not.
- **The Chair** uses structured output (JSON schema) for the setup, the cruxes, the draft, and the verdict, so the page always gets clean data. The full protocol it follows is in `council/CHAIR.md`.
- **Each seat scores every option**, weighted by how much that seat's pillar matters to your decision. The verdict is capped when a seat flags ruin risk, and the Chair forces a real argument when everyone agrees too fast.
- **Sessions are saved in your browser** (localStorage, the last 100 councils). The Chats sidebar lists them by date next to the shipped examples, replays any of them, and downloads the PDF. Nothing about your question is stored on the server.

## Deploy to Vercel

1. Import this repo in Vercel (or `vercel link`). There is nothing to configure: `vercel.json` sets the build (`node app/scripts/build.mjs`), the output folder (`app/public`), and the functions (`api/*.mjs`, which bundle `council/**`).
2. Make sure [AI Gateway](https://vercel.com/docs/ai-gateway) is enabled for the team. On Vercel the functions authenticate with the project's OIDC token automatically, so no API key is needed. Gateway usage bills to the team.
3. Optional: set the env vars below, then redeploy.
4. Optional but recommended: turn on **Vercel Authentication** (Project → Settings → Deployment Protection) so only your team can run councils on your bill.

### Environment variables

| Variable | Default | What it does |
|---|---|---|
| `SEAT_MODEL` | `spacexai/grok-4.20-non-reasoning` | Gateway model id for every seat |
| `CHAIR_MODEL` | `spacexai/grok-4.3` | Gateway model id for the Chair (needs structured output) |
| `AI_GATEWAY_API_KEY` | none | Only needed outside Vercel (local dev). On Vercel, OIDC (`VERCEL_OIDC_TOKEN` / `x-vercel-oidc-token`) is used first. |
| `AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh/v1` | OpenAI-compatible Gateway endpoint |
| `MOCK_MODEL` | off | `1` answers every call with fake but well-formed output. For tests and UI work; no Gateway calls. |

Any xAI model in the Gateway works; list them with `curl https://ai-gateway.vercel.sh/v1/models`. Keep the Chair on a model that supports JSON-schema structured output.

## Run it locally

Needs Node 20 or newer. No dependencies to install.

```
cp .env.example .env    # add AI_GATEWAY_API_KEY, or run `vercel env pull` for an OIDC token
npm start               # http://localhost:4730
```

- `MOCK_MODEL=1 npm start` runs the whole room with a fake model, free.
- `npm test` builds, starts the server with the mock model, and runs three complete councils (full, quick, custom seats) through the real API handlers.
- `LIVE=1 npm test` runs one quick council against the real Gateway. Add `BASE=https://your-deployment.vercel.app` (and `BYPASS=<protection bypass secret>` if the deployment is protected) to test a deployment.

## What's inside

| Path | What |
|---|---|
| `council/brains/` | One brain per advisor, compiled from public sources |
| `council/agents/` | One persona per advisor (`council-<name>.md`) |
| `council/roster.json` | Every advisor, your default board, and how the board is picked |
| `council/CHAIR.md`, `council/references/` | The Chair's protocol, round prompts, scoring, and report template |
| `api/` | Vercel functions: `config`, `chair`, `seat` |
| `app/lib/` | Server side: Gateway client, prompts and seat loading, request handlers |
| `app/public/` | The room: page, council runner (`runner.js`), shared prompts and scoring (`engine.js`), PDF builder |
| `app/server.mjs` | Local dev server that serves the page and the same API |
| `sessions/` | The three example councils |

## About the advisors

These are simulations built from each person's public work, They are not the people, they don't speak for them, and none of them is affiliated with or endorses this project. A seat only quotes a person verbatim when the line is in its brain with a source, and `python council/scripts/check_quotes.py sessions/<session>` checks every quote in a council against the brains. Each brain's `sources.md` lists what it was built from.

Originally built by AI Automation Society ([nateherkai/roast-room](https://github.com/nateherkai/roast-room)); this fork adapts it for Vercel and Grok. The code is MIT licensed; see `LICENSE`. The PDF builder bundles [jsPDF](https://github.com/parallax/jsPDF) (MIT) and [Montserrat](https://github.com/JulietaUla/Montserrat) (SIL Open Font License); their licenses sit next to them in `app/public/`.
