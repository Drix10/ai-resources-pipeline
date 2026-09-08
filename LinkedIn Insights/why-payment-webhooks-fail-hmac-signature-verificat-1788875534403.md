# Why Payment Webhooks Fail HMAC Signature Verification


![Why Payment Webhooks Fail HMAC Signature Verification](/slides/why-payment-webhooks-fail-hmac-signature-verificat-1788875534403.png)

When integrating Dodo Payments webhooks in intent-canvas, standard `express.json()` middleware silently broke HMAC SHA256 signature verification.

The root cause was request lifecycle ordering: `express.json()` parses the raw stream into JavaScript objects before handlers run. Re-stringifying `JSON.stringify(req.body)` alters whitespace, key ordering, and unicode encoding, invalidating the calculated cryptographic digest.

To fix this reliably:

1. Capture the raw immutable binary Buffer during request streaming via `express.json({ verify: (req, res, buf) => { req.rawBody = buf; } })`.

2. Calculate the HMAC SHA256 signature against `req.rawBody` and compare it to the incoming webhook header using `crypto.timingSafeEqual` to prevent timing attacks.

3. Pass the validated `req.body` into Zod schema pipelines only after cryptographic authenticity has been verified.

Never verify signatures on parsed JSON. Always bind your HMAC check directly to the raw byte stream before application validation executes.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [Drix10/intent-canvas: Visual Workspace Mapping Natural Language to Agent Graphs](https://github.com/Drix10/intent-canvas)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/intent-canvas running or compiling.
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
