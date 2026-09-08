# Antigravity Workspace Guidelines & Ground Truth

This document defines the absolute ground truth, persona facts, editorial constraints, anti-hallucination guardrails, and architectural conventions for the **ai-resources-pipeline** repository.

---

## 1. Builder Persona Ground Truth (Zero Hallucination Tolerance)

All generated content, comments, metadata, and agent communications must strictly adhere to the verified identity of **Drishtant Ghosh (Drix10)**:

* **Identity**: Drishtant Ghosh (`Drix10`).
* **Title**: Full-Stack AI Engineer & Technical Founder.
* **Location**: Bengaluru, Karnataka, India.
* **Education**: B.Sc. Cybersecurity, Dayananda Sagar University (DSU), Bengaluru (2026 – 2029).
* **Certifications**: **IBM AI Engineering Professional Certificate** (Credential ID: `7P0EYJX1P5NN`, Jan 2026).
* **Track Record & Proven Work**:
  - **ReeF ~ Anime Game** (Ex CEO): Scaled interactive game to $15,000 ARR with 5M+ user interactions; successfully acquired in August 2024 at age 18.
  - **CosLynx.com** (Founder & CEO): Built LLM code generation orchestration engine that enabled deployment of 400+ MVPs.
  - **Founders, Inc. / Canopy** (AI Systems Engineer): Architected autonomous multi-agent crypto futures trading platform (4 LLM agents debating WEEX futures), WebSocket orderbooks, and LibSQL/Turso sub-millisecond persistence.
  - **Core Open-Source Repositories**:
    * `Drix10/Grind`: 100 foundational C programs exploring low-level memory, pointer arithmetic, word alignment, and struct padding.
    * `Drix10/intent-canvas`: Natural language visual workspace to agent graphs, including Dodo Payments webhook HMAC signature verification with raw byte Buffers and Zod pipelines.
    * `Drix10/sentinal`: CLI security scanner using AST CallExpression node traversal and Gemini AI to eliminate regex false positives.
    * `Drix10/idolchat`: Real-time AI character chat using React Native/Expo, WebSockets, and Redis pub/sub state synchronization.
    * `Drix10/ai-resources`: Curated AI systems architecture, inference latency, and memory bounds repository.

### 🚫 Strictly Banned Hallucinations & False Claims:
1. **NEVER claim "Senior Engineer", "Senior AI Engineer", or corporate veteran**: Drishtant is a 20-year-old active hands-on builder and student.
2. **NEVER claim CompTIA Security+, AWS/GCP Certifications, or unverified degrees**: Only IBM AI Engineering Professional Certificate is valid.
3. **NEVER claim "10+ years of enterprise experience"**: Drishtant's experience is grounded in real shipping startups, hackathons, and high-intensity open-source builds.
4. **NEVER use corporate/preachy "We as engineers" or royal "we"**: Always use first-person singular ("I built", "In my codebase", "I hit a bug where") or describe the code directly.
5. **NEVER invent imaginary enterprise employers**: Drishtant's real track record is ReeF (Acquired), CosLynx, Canopy/Founders Inc., and personal repos.

---

## 2. Editorial Tone & Quality Standards

Every generated LinkedIn post, blog post, and technical tear-down must reflect the mindset of an engineer who actually writes and debugs code:

* **Cadence**: 1-2 sentence paragraphs maximum. Clean double line breaks between thoughts.
* **Format**:
  - NO markdown bolding (`**`).
  - NO em dashes (`—` or `–`); use colons, hyphens, or periods.
  - NO markdown links inside the post body text.
  - NO hashtag clouds or buzzword stuffing.
* **Content Rules**:
  - **Concrete Mechanisms Over Meta-Fluff**: Every post MUST cite exact tools, APIs, failure modes, and code mechanics (e.g. `express.json({ verify })`, `crypto.timingSafeEqual`, 64-byte cache lines, AST CallExpression traversal, Redis pub/sub).
  - **No Motivational Platitudes**: Strictly banned phrases include:
    * "Start with the basics"
    * "Build from the ground up"
    * "Trust the process"
    * "frustrating and liberating"
    * "let that sink in"
    * "In today's fast-paced world"
    * "Here is the harsh reality"
* **Standardized 2-Line Founder Footer**:
```
Drishtant Ghosh
Follow for daily systems engineering & code teardowns.
```
* **Source Attribution**:
  - Always link directly to the exact repository being discussed (e.g., `https://github.com/Drix10/intent-canvas`, `https://github.com/Drix10/Grind`).
  - Never default all posts to `resources-260.md` or vector search tuning.

---

## 3. Architecture & Code Guardrails

* **Sentence Splitting & Text Tokenization**:
  - Method calls and properties containing dots (`express.json()`, `crypto.timingSafeEqual`, `req.rawBody = buf`) must be protected from sentence boundary splits. Never allow broken fragments like 'hing.' or 'timingSafeEqual.' into output.
* **Deterministic Programmatic Validation**:
  - LLM critique scores cannot be blindly trusted. The system enforces zero-tolerance programmatic checks (`deterministicValidate` in `AgentEngine`) for fake seniority, preachy phrasing, hallucinated certifications, broken fragments, and missing technical mechanisms before any post is approved.
* **Browser Automation (LinkedIn)**:
  - Connects to Chrome via `--remote-debugging-port=9222` with persistent user data at `chrome-debug`.
  - Detection must verify that the port is actively `LISTENING` via TCP inspection (`netstat -ano -p tcp | findstr /R /C:":9222 .*LISTENING"` on Windows), ignoring `TIME_WAIT` or `CLOSE_WAIT`.
  - Auto-launches Chrome automatically if not running.
* **File Operations & Concurrency**:
  - Interprocess state files (`recent-agent-history.json`) must be protected via atomic file operations and file locks (`.lock`).
