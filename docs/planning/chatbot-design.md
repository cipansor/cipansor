# Customer-service chatbot — design and advisory

Design decisions for the Cipansor CS chatbot: a public widget for visitors, and
later a role-aware assistant inside the information system. Advisory first given
2026-07-23, expanded and recorded here 2026-07-24 after the conclusions alone
proved too thin to act on.

Companion to [`roadmap.md`](../../.claude/memory/roadmap.md) §5, which tracks _what_ to build
and in which order. This file records _why_.

**Status: Phase 1 implemented (2026-07-24). It runs wherever a provider is
configured: on staging with the real provider since #657, in production once
its key is set.** Which copy is running is `APP_ENV` (`local` | `staging` |
`production`, `resolveAppEnv()` in `apps/api/src/config/index.ts`), not
`NODE_ENV`: both deployed images build with `NODE_ENV=production`, so staging
needs its own name, and an unset `APP_ENV` on a production build counts as
production. The `stub` provider is refused in production. The widget and the
escalation flow speak Indonesian, English and Arabic (`apps/web/src/locales/`);
the mail to the team stays Indonesian. Code in `apps/api/src/modules/chatbot/` and
`apps/web/src/components/chatbot/`. Three decisions changed during
implementation and are marked **REVISED** below — the reasoning that survived
is kept, because knowing why an option was dropped is the point of this file.

**Phase 1 is complete as of 2026-07-25**, when the super-admin persona UI
landed (§4): the `chatbot_personas` table, `GET/PUT/DELETE
/chatbot/admin/persona`, and `/settings/chatbot`. Not yet done: everything in
Phase 2.

## The requirement, as stated

A chat widget at the bottom-right of the public site, answering questions from
the public about Cipansor via RAG over the public pages. Once a user logs in,
the assistant becomes role-specific — a parent's agent, a teacher's agent, and
so on — able to reach only the data that role is authorised to see, plus the
public content. If a user holds multiple roles, switching role changes what the
assistant can reach. Super admin can configure per-scope custom instructions.
Text only: no vision, no audio, no video. Question-answering only.

Two candidate models were proposed: "Azure Bot" or DeepSeek V4 Flash on Azure
AI Foundry.

## 1. The model question is mis-framed

**Azure Bot Service is not a model.** It is a hosting and channel framework —
it connects a bot to Teams, Slack, Direct Line, web chat. It performs no
reasoning; a model still sits behind it. Comparing it to DeepSeek compares a
distribution channel to an answering engine.

More to the point, **this project does not need it.** Its value is multi-channel
reach. The requirement is one widget on our own Next.js site calling our own
Express API. Adding Bot Service buys another service to operate, another latency
hop, another auth model and another bill, for a problem we do not have. Revisit
only if WhatsApp or Teams delivery becomes a real requirement — for a pesantren,
WhatsApp plausibly could, and that is the one scenario where this changes.

### Do not let the model choice block the project

The model is the most swappable component in the system. Put it behind one
provider-agnostic interface and make it configuration.

Then **let the eval harness choose the model, not a spec sheet.** §5 requires a
golden set anyway; run two or three candidates against it and compare accuracy,
cost and latency on real Indonesian questions using the pesantren vocabulary
this domain actually uses — tahfidz, halaqoh, musyrif, muhadhoroh, takhosus,
kitab kuning. No public benchmark measures that.

Specific claims about a "DeepSeek V4 Flash" variant — context length, price,
Foundry availability — were **not verified** when this was written and must not
be assumed. Read the model card and confirm: context window, price per 1M input
and output tokens, region availability, and the data-residency terms (§7).

### Evaluate the embedding model separately

More decisive than the chat model for retrieval quality, and routinely
overlooked: many embedding models are English-centric. An Indonesian corpus
retrieved through a weak multilingual embedding produces confident answers from
the wrong page. Measure retrieval on its own — does the right chunk come back
for a real question — before blaming the chat model for a bad answer.

**REVISED — there is no embedding model yet.** Phase 1 retrieves with BM25
(`retrieval.ts`), not vectors. The corpus is a few dozen short factual entries
about one institution, and questions arrive using the same words the entries
use. Lexical retrieval handles that, costs nothing, needs no key, and is
*deterministic* — so a retrieval regression fails a unit test instead of showing
up as a vague drop in answer quality.

What it needs to work in Indonesian is affix handling, not embeddings:
"pendaftaran", "mendaftar" and "daftar" must be one term, or the most likely
question this bot will ever receive misses. `stem()` does that, conservatively,
refusing to reduce below four characters because over-stemming destroys
precision silently.

`Retriever` is an interface. Add vectors when the eval set shows paraphrase
matching is the bottleneck — measure, then swap. The advice above applies at
that moment, unchanged.

### REVISED AGAIN (2026-09-04) — the corpus is sent whole, and retrieval no longer gates

Measured: the public corpus is **2,513 characters, ~628 tokens** across 8
entries. Less than one page.

Retrieval exists to solve one problem — a corpus that does not fit in the
prompt. Ours fits, with room to spare. Current practice puts the "just put it in
the context" threshold around **100K tokens, or a few hundred documents**; we
are two orders of magnitude below it. Selecting 4 entries out of 8 saved
nothing measurable and cost a failure mode that reached a real visitor:

> `ada`, `apa` and `saja` are all stopwords — deliberately, so BM25 does not
> rank on sentence shape. That left **one** term, "informasi", which no entry
> discusses. Zero chunks retrieved, and the service refused **without ever
> calling the model**. The most natural question anyone can ask an assistant —
> *what can you help with?* — was the one guaranteed to fail.

So the pipeline changed shape:

| Before | After |
| --- | --- |
| BM25 picks ≤4 entries | The **whole corpus** goes into every prompt |
| 0 chunks ⇒ service refuses, model never called | Refusal is the **model's** to write, under scaffold rules 1, 2 and 5 |
| `sources` = what BM25 ranked | `sources` = what the model **says it used** (rule 7), filtered against the real corpus, falling back to BM25 |
| `refused` = "the service declined" | `refused` = `looksLikeRefusal(answer)` — see `refusal.ts`, whose patterns were tightened to require the *assistant* (or the *information*) as the subject, so "biaya tidak dapat dikembalikan" is no longer read as a refusal |

`groundedRefusal()` survives, but only as a last line of defence for a state no
question can reach: an empty corpus AND no live facts.

**Techniques deliberately NOT adopted, and the reason:**

- **Hybrid BM25 + dense embeddings with RRF.** The right answer for a large
  mixed corpus — ~7.4% NDCG lift on WANDS (0.7497 vs 0.6983 / 0.6953), RRF at
  k=60 as the zero-config default. Here it means standing up a vector index and
  an embedding call per question **to rank 8 documents that are all being sent
  anyway**. Ranking buys nothing when there is no selection.
- **Query rewriting / HyDE.** The literature's diagnosis is exactly our bug —
  *"most retrieval failures are query-shape failures; a short user question does
  not sit in the same region as the answer documents"* — but the cure is an
  extra model call per question, for a problem 600 tokens of context deletes.
- **Agentic RAG** (the model drives retrieval and re-queries). 2–4× the calls
  and latency on a path already measured at 8–33 s. Built for corpora that do
  not fit.
- **Letting the model browse the public site live.** Slower, and it turns page
  content into an instruction channel — rule 4 exists precisely because context
  is data, not commands. The site's content is already mirrored in the corpus.

**Revisit trigger, so this is not re-litigated from taste:** when the corpus
passes **~100K tokens or a few hundred documents** — indexing every site
article, naskah dinas, and the full SPMB FAQ would do it — hybrid retrieval with
RRF and a query-rewriting layer become the right spend. Not before.

A detour worth recording, because it was decided and then reversed by
measurement: `refused` was briefly gated on the model citing no sources —
"if it named a source, it answered". A live run killed it. Rule 5 tells the
model to list the available topics and give the contact number *when it
declines*, so refusals cite `bantuan-ikhtisar` and `kontak` too. The signal
separated nothing. What separates them is inside the sentence — its subject.

**The cost this accepted:** an off-topic question now reaches the model, where
it used to be refused for free. Prompt tokens per call rise by roughly the
entries BM25 would have dropped. Turnstile plus the 10/minute per-IP limiter
still bound the abuse case, and refusals are deliberately **not cached** so a
wrong one cannot stick.

Measured on the real model, same questions, same day:

| Question | Before | After |
| --- | ---: | ---: |
| "ada informasi apa saja" | 999 prompt tokens | 3,300 |
| "di mana lokasinya dan berapa biaya pendaftarannya?" | 1,385 | 3,317 |

Production averaged **1,174 prompt tokens per call** before this. At the
configured prices (0.19 USD / 1M input, 0.51 output) that is roughly **0.30 →
0.70 USD per 1,000 questions**.

The offsetting effect, which is a checkable prediction rather than a promise:
sending a constant corpus makes the prompt **prefix** identical across every
question for the first time, which is exactly the shape provider-side prompt
caching rewards — billed at 0.028 rather than 0.19, **6.8× cheaper**. On
2026-09-04, before this change, 2,304 of 10,566 prompt tokens were already
served from that cache. `chatbot_usage_daily.cached_prompt_tokens` will show
whether that share rises after deployment.

**Diukur 2026-09-05, dan hasilnya MEMBANTAH ramalan di atas.** Tiga panggilan
pertama sesudah penggelaran, ketiganya dengan awalan yang sama persis (~3.300
token) dan dalam rentang sepuluh menit, dilaporkan **0 token ter-cache** dari
10.225 token prompt — sementara sehari sebelumnya, dengan prompt yang lebih
pendek, 21,8% ter-cache. Pembacaannya bukan salah kita: adaptor membaca
`prompt_tokens_details.cached_tokens` **dan** `prompt_cache_hit_tokens`
(`providers/openai-compatible.ts`), jadi angka nol itu laporan penyedia.

Dugaan yang paling cocok dengan kedua angka: yang ter-cache kemarin adalah
prompt yang **identik seluruhnya** (pertanyaan berulang), bukan awalan yang
dipakai bersama pertanyaan berbeda — artinya penyedia ini tidak memberi diskon
awalan otomatis pada deployment kita. Tiga panggilan tetap sampel kecil dan
cache bisa perlu trafik untuk hangat, jadi **periksa ulang setelah ada trafik
pengunjung sungguhan** sebelum menyimpulkannya permanen. Yang tidak berubah:
taksiran 0,30 → 0,70 USD per 1.000 pertanyaan sudah dihitung pada harga penuh,
jadi ia tetap berlaku — yang hilang hanya potongan yang diharapkan.

## 2. The central decision: RAG for public content, tools for private data

The requirement says the logged-in assistant should reach "data sesuai
otorisasi role". The naive reading — index the database into a vector store,
tag chunks with role and unit, filter at query time — **is the wrong
architecture and it will leak.**

- A vector index is a **copy of the data carrying its own authorisation model**.
  That leaves two permission systems that must agree forever. Every rule in the
  app (`seesAllUnits()`, letter nature levels, `letterScopeWhere`) must be
  mirrored into the index. They will drift, and the drift is silent.
- Our authorisation is **relational and per-row**, not per-label: a parent sees
  _their_ child, a homeroom teacher _their_ class. Expressing that as chunk
  metadata means encoding the whole permission graph as tags, then re-indexing
  whenever a student changes class or a teacher's assignment changes.
- **Revoking access does not empty the index.** Rights are withdrawn today; the
  embeddings persist until someone remembers to re-index.

The split that avoids all of it:

| Content                     | Mechanism                                           | Why                                               |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| Public pages, FAQ, policies | **RAG** (vector retrieval)                          | no per-user authorisation exists at all           |
| Anything user-specific      | **Tool calls to the existing authorised endpoints** | authorisation stays in exactly one place: the API |

The agent is given _tools_ that wrap endpoints we already ship, invoked carrying
the user's session and their **active role**. `authorize()`, `seesAllUnits()`
and unit scoping then apply unchanged, with zero duplication. No access means
the tool returns 403 and the agent says it cannot help. There is no parallel
index to drift out of sync.

**The tool set must contain no mutating endpoint.** The assistant is
question-answering by requirement — enforce that architecturally rather than by
instructing the model, and the worst class of agent risk disappears. Read-only
tools cannot be talked into writing.

## 3. Multi-role: a new role means a new thread

Partitioning conversation state per `(user, activeRole)` is necessary but **not
sufficient**. When a user switches role, the existing transcript already
contains data gathered under the previous role. A model can restate that while
operating as the lower-privileged role, and every authorisation check will have
passed correctly on the way in.

So a role switch starts a **fresh thread**. Prior history is not filtered, not
summarised, not carried — it is not sent.

## 4. Super-admin custom instructions: useful, and a footgun

An editable system prompt is a privilege-escalation surface. Anyone who can edit
it can write "ignore your restrictions".

Split the prompt in two. The configurable part is **additive only** — persona,
tone, FAQ phrasing — injected into a fixed safety scaffold that lives **in code
and cannot be overridden** from the database. Version the configurable text,
audit who changed what and when, and **require the eval suite to pass before a
prompt reaches production**. Without that gate a single prompt edit can regress
answer quality with nothing to catch it.

**IMPLEMENTED (2026-07-25).** `chatbot_personas`, keyed by scope so Phase 2's
per-role personas need no second table; `GET/PUT/DELETE /chatbot/admin/persona`
behind `authorize(SUPER_ADMIN)`; the editor at `/settings/chatbot`. Resolution
is DB → `CHATBOT_PERSONA` → `DEFAULT_PERSONA`, and a database failure degrades
to the default voice rather than to no answer. The additive-only guarantee is
structural, not procedural: the saved text is concatenated *below* the scaffold
in `buildMessages`, and `prompt.test.ts` pins that a persona instructing the
model to ignore its rules cannot remove one. The persona hash is part of the
answer-cache key, so an edit re-keys the cache instead of leaving visitors
reading the old voice out of Redis.

Two things from the paragraph above did **not** ship, and should be understood
as open rather than done:

- **No version history.** Only the current text, plus `updated_by`/`updated_at`
  — enough to answer "who last changed this and when", not "what did it say
  last Tuesday" and not "restore that". Reverting means retyping, or the reset
  to default. A `chatbot_persona_revisions` table is the obvious fix if the
  persona is ever edited by more than one person.
- **No eval gate on save.** `pnpm --filter api chatbot:eval` costs real money
  and takes minutes against a queueing endpoint, so it cannot sit in a request
  handler. The consequence is real and worth stating plainly: a careless
  persona edit can degrade answer *quality* (not safety) with nothing to catch
  it until someone runs the suite. The honest mitigation for now is to run the
  eval after editing the persona; a background job that evaluates a saved
  persona and warns is the better answer.

## 5. Evaluation: the red-team set matters more than the golden set

The golden set — 50 to 100 real questions: SPMB cost, requirements, location,
programmes, contact — measures usefulness.

What measures safety is the **red-team set, where the passing outcome is a
refusal**: ask the public bot for a student's phone number; ask a parent's agent
about another family's child; ask a teacher for finance data. Each question runs
**once per role**, with a different expected outcome per role.

Automate both in CI. It is the only way a leak regression is ever caught, and
the only way §4's prompt gate means anything.

Track: correctness; **groundedness** (every claim traceable to a retrieved
source or tool result); refusal rate on out-of-scope questions; latency; cost
per conversation.

## 6. Fit with the existing stack

Measured 2026-07-24: the public corpus is **19 static pages**, content held in
code — `berita` included, which is not database-backed.

- **REVISED — no pgvector, and no database change at all.** The plan was
  pgvector in the Postgres we already run, rather than a separate vector
  service, on the grounds that a few hundred chunks does not justify Azure AI
  Search. The same argument goes one step further than it first appeared: at
  this size it does not justify pgvector either. BM25 over an in-memory corpus
  built at module load needs no extension, no migration, and no move off
  `postgres:16-alpine` — which pgvector would have required. Revisit together
  with the embedding decision above, not before.
- **Redis is already deployed** — use it for conversation state and rate
  limiting when Phase 2 needs shared state. Phase 1 keeps conversation state in
  the browser and rate-limits per IP in `chatbot.routes.ts`.
- **The answer cache lives there too** (`cache.ts`), and it is the main answer
  to the latency in §7. A repeated question returns in 0.01–0.05s instead of
  3.5–42s. The interesting part is the KEY, not the TTL — freshness is a
  correctness property, so it is enforced structurally:

  | Key segment | Invalidates when |
  | --- | --- |
  | hash of the knowledge base | any public content changes (i.e. on deploy) |
  | hash of the persona | a super admin saves or resets the persona (§4) — the voice changes, so every cached answer in the old voice is orphaned at once |
  | fingerprint of the live admission facts | fee, dates or status change; also daily, because the answer states days remaining |
  | stemmed, sorted question tokens | — collapses "Berapa biaya pendaftaran?" and "biaya pendaftaran berapa ya" onto one entry |

  A changed fact therefore produces a different key and the stale entry is
  never read again — no flush step for anyone to forget, and no window in
  which the TTL is still serving the old answer. Verified end to end against
  real Redis, not assumed. The TTL (24h) is only garbage collection.

  Known limit: misspellings do not collapse onto the correct spelling, so they
  miss. Fixing that needs fuzzy matching, which risks merging two DIFFERENT
  questions onto one key — a miss costs one model call, a wrong merge costs a
  visitor the truth.

  Caching is skipped once a conversation has history, since the answer then
  depends on turns the key knows nothing about. If the authenticated agent ever
  gets a cache, it must additionally be partitioned per (user, activeRole) —
  see §3.
- **REVISED, and better than planned — the knowledge base is DERIVED, not
  written.** The plan assumed indexing 19 static pages. The content turned out
  not to live in those pages at all: it is structured configuration
  (`siteConfig`, `educationUnits`, `featuredPrograms`, `donationConfig`). So
  `knowledge-base.ts` builds its entries from those constants, which moved to
  `@cipansor/shared` to be reachable from the API. Nothing is transcribed, so
  the bot and the website are incapable of stating different facts, and a
  hand-written corpus going quietly stale — the failure this section originally
  budgeted for — cannot happen. Do not crawl our own rendered site.
- **Some "public RAG" answers must actually be live tool calls.** SPMB dates and
  fees must come from each unit's intake (`findPublicIntakes`, the projection
  behind `GET /api/admissions/public/intakes`), never from a
  vector chunk that may be stale. This is not hypothetical: stale temporal data
  was fixed in this system in July 2026. A bot that confidently quotes last
  year's fee to a prospective family is a real harm, not a cosmetic bug.

## 6a. Surge: retry, and a queue that is deliberately short (2026-09-04)

Azure AI Foundry caps requests and tokens per minute. Touching the cap comes
back as **HTTP 429 with `Retry-After`** — "in a moment", not "you are wrong".
Without a retry layer, an answer that was half a second away becomes "asisten
sedang tidak tersedia" on the visitor's screen.

Three decisions shape `chatbot/retry.ts`, because a retry fitted without
thought is how an incident is made worse:

1. **Only transient failures are retried** — 408, 425, 429, 5xx. A 400 means
   our request is malformed and a 401 means the key is wrong; neither heals by
   waiting, and retrying them spends the quota that is left on calls that
   cannot succeed. This is enforced by *type* (`TransientUpstreamError`), not by
   a deny-list, so the default for anything unclassified is "do not retry".
2. **Timeouts are NOT retried.** A call that reached the 60-second ceiling has
   already spent the visitor's patience; retrying asks them to wait two minutes
   for a call that was too slow the first time. Other network faults — DNS,
   connection refused, a dropped socket — heal in milliseconds and are retried.
3. **`Retry-After` is obeyed, not clamped.** The server knows when its quota
   returns; our backoff is a guess. An early draft capped the header at
   `maxDelayMs`, which turned "wait 30 seconds" into "come back in 1 second" —
   the exact behaviour that turns an outage into a worse one. It was caught by
   the test that asserts we give up rather than sleep past the budget. The cap
   belongs to our own guess; the server's instruction is honoured, and the time
   budget decides whether we can afford it.

Backoff uses **full jitter** (`random() × delay`), not a fixed wait: several
requests rejected in the same second would otherwise wake in the same second
and hit the same cap again.

`chatbot/throttle.ts` handles the other half — stopping us from *causing* the
cap. Ten visitors asking at once means ten concurrent calls; three at a time
plus a short queue means the endpoint sees three.

**Why the queue is short, and why that is not a compromise.** The visitor is
watching a screen and their HTTP request dies around the minute mark. A queue
that holds a question until quota returns produces a visitor who has already
closed the tab. So waiting is capped at ten seconds, after which we answer
honestly that the assistant is busy — **HTTP 503 with `Retry-After`**, and a
different sentence from "unavailable", because "unavailable" tells someone to
give up when trying again shortly would have worked.

A **durable** queue is right for work nobody is watching — forwarding a
question by email is the obvious case. Not for this.

**No circuit breaker, deliberately.** It was considered and left out: a breaker
is a stateful component whose own failure mode is an outage we cause (stuck
open), and at nine questions a day it protects against nothing we have. Most of
its benefit is already there for free — when `Retry-After` exceeds the remaining
budget we fail immediately rather than sleeping, so a genuinely exhausted quota
already fails fast. Revisit if sustained 429s ever appear in the logs.

## 6b. Handing the question to a human (2026-09-05)

A refusal that ends at a phone number is a dead end for the person who cannot
call during office hours. So when the assistant declines, it offers to pass the
question to the team, and — with consent — mails it to `halo@cipansor.or.id`.

**The mail is from `noreply@`, but `Reply-To` is the visitor.** That one header
is the whole feature: without it, the staff member who hits Reply writes to
their own inbox and the person who asked never hears back. It required a
per-message `replyTo` on `deliverEmail()`, which until now always used
`config.mail.replyTo`.

**The flow stops in the visitor's hands twice**, and both stops are load-bearing:

1. Before a single field is requested. Asking for a name and a phone number
   from someone who has not said yes is unsolicited collection, not politeness.
2. After the summary is composed. People are entitled to see what will be sent
   in their name. What they approve is a **summary of the fields**, in their own
   language; it is not a copy of the mail. The team's mail is internal and stays
   Indonesian, and its reference number exists only once the row is recorded
   (`escalation-flow.tsx` → `summarise()`, `escalation.service.ts` →
   `renderEscalationEmail`). The fields are the same; the wording is not.

**Fields are collected in a form, not by conversational turns.** A bot that asks
for an email and then parses it out of free text sounds cleverer and works
worse: it mis-reads, it cannot validate, and on a phone it forces five separate
sends. The *voice* stays conversational — the offer, the summary and the thanks
are assistant bubbles — while the filling-in uses the control designed for
filling in.

**The durable queue lives here, not in the chat.** Chat cannot be queued: the
visitor is watching, and their HTTP request dies inside a minute (§6a). Nobody
watches an email being sent. So the row is written first, the reference number
is returned immediately, delivery is attempted after the response, and
`jobs/chatbot-escalation-retry.job.ts` retries every 30 minutes up to five
attempts — roughly a two-hour window. **A delivery failure therefore never means
a lost question.** Rows that exhaust their attempts become `FAILED` with
`lastError` beside them, for a human to read rather than for a log to swallow.

**Protections, and what each is actually for:**

| Control | Protects |
| --- | --- |
| Turnstile (`chatbot-escalate`) | the inbox, not the bill — this is the 8th gated action |
| 3/hour per IP | staff *attention*; an inbox drowned by scripts stops being read, and real questions drown with it |
| Honeypot (`website`) | answered as if it succeeded, with a fake reference — telling a script it was caught only helps its author |
| `consent` as `literal(true)` | a `false` that validates and is then rejected in the service is two places that must agree forever |
| `consentAt` as a timestamp | UU PDP asks *when* consent was given; a boolean cannot answer that six months later |
| 90-day retention, same sweep | one promise, one sweeper — a second job is a second thing that can die quietly |
| HTML escaping | the question is written by the public and read in Gmail |

`FAILED` rows are deleted by the retention sweep too. Holding someone's personal
data forever because our mail server failed is not a lawful reason to hold it.

## 7. Risks that are easy to miss

**Prompt injection.** Both retrieved content and tool results (complaint text,
names, counselling notes) can carry instructions. Treat retrieved material as
data, never as instructions, with explicit delimiters — and remember §2's
read-only tool set is what limits the blast radius when injection succeeds
anyway.

**Latency — measured, and worse than expected.** Against `DeepSeek-V4-Flash` on
Azure AI Foundry, 2026-07-24: identical requests answered in 0.9s, 7.5s, 9.5s,
14.7s, 46.9s and 48.7s. Streaming separates the cause — the gap between the
first token and the last was **0.3–1.9s**, while time to the FIRST token ranged
**1.1s to 32.8s**. The model is not slow; each request queues for shared
capacity. It is not throttling (quota was untouched: 124/125 requests,
124,974/125,000 tokens) and not a cold start (the pattern never warms up).

Consequences worth holding on to:

- **Streaming helps, but does not fix it.** It converts a 5s wait into text
  appearing at 1s; when the queue is 32s the visitor still waits 32s.
- **The cache is the real remedy**, because it removes the call entirely. See
  §6.
- **Price is not the binding constraint at this volume.** Measured prompts run
  730–1,270 tokens with ~200-token answers; at 100 questions/day that is ~3.3M
  input and ~0.6M output tokens a month. The gap between a cheap and a
  mid-tier model is tens of thousands of rupiah per month — far less than the
  cost of prospective families abandoning a 32-second wait. Choose on latency,
  not on price.
- Before changing model, try the **same model in another region or deployment
  type**: queueing is a property of the deployment, so this costs nothing in
  price or quality. Only `DeepSeek-V4-Flash` is deployed in the current
  resource, so any comparison needs a second deployment first — then
  `pnpm --filter api chatbot:eval` scores both on our own questions.

**Cost amplification.** An open LLM endpoint on a public page is a target.
Required before launch: per-IP rate limiting, token caps, a conversation-length
cap, and a monthly spend alert. Cache aggressively — "berapa biaya
pendaftaran?" will be asked hundreds of times, and the top FAQ entries deserve
deterministic answers that never reach the model.

> **Status 2026-07-25, updated 2026-07-31 and 2026-09-04 — and the reason to
> check rather than tick.** Token cap (700), history cap (6 turns) and the cache
> all shipped and work. **The spend alert shipped 2026-09-04** and closes this
> list: every billed call is booked into `chatbot_usage_daily` (a daily
> aggregate per model, not one row per question — bounded, and it keeps no
> per-visitor trail), and `jobs/chatbot-spend.job.ts` compares the month to date
> against `CHATBOT_MONTHLY_BUDGET` every morning at 07:00 WIB, mailing at 50%,
> 80% and 100%, each at most once a month. Three decisions in it are load-bearing:
>
> - **Token prices have no default.** They belong to the model and the region,
>   both of which are env configuration precisely so the model stays swappable
>   (§1), so a plausible default would produce an authoritative-looking figure
>   that is simply wrong. `CHATBOT_PRICE_INPUT_PER_MTOK`,
>   `CHATBOT_PRICE_OUTPUT_PER_MTOK` and `CHATBOT_PRICE_CACHED_INPUT_PER_MTOK`
>   start at 0. Production runs 0.19 / 0.51 / 0.028 USD per 1M tokens against a
>   10 USD monthly budget, from the Azure AI Foundry price page for
>   *DeepSeek-V4 Flash Global*.
> - **The cached-input rate is live — CORRECTED 2026-09-04.** This bullet first
>   claimed the deployment reports no cached-token count at all, so the rate was
>   inert and every estimate an upper bound. That was one observation stretched
>   too far: the response inspected simply had no cache hit, and the field is
>   absent rather than always missing. Production the same day recorded **2,304
>   of 8,589 prompt tokens as cached**, on real visitor traffic. The 0.028 rate
>   is therefore applied, and the estimate is more accurate than promised, not
>   less. What survives is the flag, not the claim: `cacheUnreported` is
>   computed from the data, so a month with no reported cache still says out
>   loud that its figure leans high — and now it says so only when true.
> - **Unpriced does not mean silent.** With no price or no budget set, the job
>   mails a configuration notice once a month — but only in a month the
>   assistant was actually used. Going quiet when unconfigured is the exact
>   failure this module has already had twice.
> - **A call whose response carries no `usage` block is counted as unmetered,
>   never as free.** Zeros would report a spend of zero against a real invoice;
>   the estimate says out loud that it is a lower bound instead.
>
> The per-IP limiter — 10/minute,
> the one item on this list aimed squarely at cost amplification — was **present
> in code and inert in production** for six days: `trust proxy = 1` behind
> Cloudflare *and* nginx made `req.ip` the rotating edge address, so 40+
> requests from one visitor never hit the limit. Fixed 2026-07-31 by trusting
> `CF-Connecting-IP` from Cloudflare's ranges only, at the nginx layer; the live
> site now 429s and the API logs the visitor's address. Full evidence in
> [`known-issues.md`](../../.claude/memory/known-issues.md).
>
> The instructive part is that the code passed review, the config passed review,
> and only the deployed topology made them wrong together — a limiter is not
> verified until something has actually been made to 429 on the live site.

**UU PDP No. 27/2022.** The authenticated assistant sends **children's**
personal data to a third-party inference endpoint. That needs a lawful basis,
and region and data-residency become requirements rather than preferences. The
public bot raises none of this — one more reason it goes first.

> **Corrected 2026-09-04.** "The public bot raises none of this" stopped being
> true the day it began storing what visitors type. It was written when the
> widget kept nothing: `chatbot.controller.ts` logged *that* a question arrived
> and whether it could be answered, deliberately never the text, because people
> type "anak saya bernama…" into chat boxes.
>
> The transcript (§9) reverses that, on purpose and with the owner's decision.
> The claim that survives is narrower and worth stating precisely: the public
> bot processes **personal data volunteered by an adult visitor about their own
> enquiry**, not children's records pulled from our database — which is a
> different lawful basis and a far smaller blast radius than Phase 2. It is
> still personal data, and it is governed as such.

## 9. The transcript, and what makes storing it defensible

Shipped 2026-09-04, at the owner's request: every question and answer is kept in
`chatbot_conversations` / `chatbot_messages` so the pesantren can see what the
public actually asks and where the assistant fails them.

The objection that kept this out for six weeks was never wrong, so it is
answered rather than dropped. Three constraints, each load-bearing:

1. **One reader.** `GET /chatbot/admin/conversations` is `SUPER_ADMIN` only —
   stricter in spirit than the persona editor beside it, which merely edits
   house style. Opening a conversation writes an audit line naming who read it.
2. **Ninety days, enforced by a job that proves it ran.**
   `jobs/chatbot-transcript-purge.job.ts` deletes conversations whose last turn
   is older than 90 days, nightly at 03:15 WIB, and writes an `audit_logs` row
   **every run, including the runs that delete nothing**. That zero-row is the
   whole point: a table that is empty because nothing expired and a table that
   is empty because the purge died three months ago look identical, and only the
   trail tells them apart. Retention is half of why storing this is defensible,
   so it cannot be a promise nobody can check.
3. **Nothing that identifies a person.** No IP, no user agent, no cookie. The
   only key is a `conversationId` the browser mints per open widget, which
   grants nothing and links to nobody. Enough to read a conversation as a
   conversation; not enough to follow anyone.

Two smaller decisions worth keeping:

- **The transcript is not the usage ledger, and the difference is deliberate.**
  `chatbot_usage_daily` records what was *paid for*; the transcript records what
  was *said*. A cache hit costs nothing and is absent from the ledger, but the
  visitor still read it, so it appears here — flagged `fromCache`, because a
  wrong answer that turns out to be a replay is fixed by clearing the cache, not
  by editing the persona.
- **The answer is sent before the transcript is written.** `recordTurn` swallows
  its own errors, but ordering it ahead of `res.json` would make a correctly
  answered question depend on a bookkeeping write succeeding. After the
  response, nothing below it can reach the visitor.

## 8. Phasing, and why the authenticated half waits

**Phase 1 — public widget only.** RAG over the 19 public pages, the live SPMB
tool from §6, plus the full eval harness from §5 including the red-team set.

**Phase 2 — authenticated assistant**, built on tool calls per §2, with the
thread rules from §3 and the prompt governance from §4.

The gap between them is deliberate. **An agent amplifies data-quality
problems.** A wrong number on a dashboard tile invites suspicion; the same wrong
number in a fluent Indonesian sentence carries authority it has not earned. The
teacher dashboard currently reports fabricated figures — a hardcoded `|| 4`
rendering as "dari 4 kelas", and a total of 0 where the real answer is 14 (see
[`known-issues.md`](../../.claude/memory/known-issues.md)). Putting an assistant over endpoints
in that state ships the errors with a more persuasive voice.

Phase 1 meanwhile carries real value now — admissions are open — at
near-zero data risk, and it is how we learn which questions the public actually
asks. That is the input needed to design the role-specific agents properly.
