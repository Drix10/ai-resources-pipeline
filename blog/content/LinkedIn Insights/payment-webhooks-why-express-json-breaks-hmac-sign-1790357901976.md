# Payment Webhooks: Why `express.json()` Breaks HMAC Signatures


![Payment Webhooks: Why `express.json()` Breaks HMAC Signatures](/slides/payment-webhooks-why-express-json-breaks-hmac-sign-1790357901976.png)

Payment webhooks often fail silently. The root cause is usually `express.json()` parsing the request body before HMAC signature verification can access the raw binary buffer.

In my `intent-canvas` codebase, I ran into this exact issue with Dodo Payments webhooks. The HMAC signatures were consistently failing, leading to dropped events and frustrating debugging. The problem was subtle: `express.json()` was transforming the raw request body into a JSON object.

HMAC signatures require the original, untampered binary buffer of the request body to generate the correct hash. When `express.json()` parses the body, it changes the byte representation, making the HMAC calculation incorrect. This results in a mismatch with the signature provided by the payment gateway.

To fix this, I configured `express.json()` to expose the raw body before parsing. The critical step is using the `verify` option: `express.json({ verify: (req, res, buf) => req.rawBody = buf })`. This attaches the original binary buffer to `req.rawBody`.

With the raw buffer available, the HMAC verification flow becomes reliable. I generate the expected signature using `crypto.createHmac` with the secret and `req.rawBody`. This is then compared against the received signature using `crypto.timingSafeEqual` to prevent timing attacks.

The order of operations is crucial. Always verify the signature *before* any business logic or schema validation, like Zod. An invalid signature means the request is untrusted and must be rejected immediately. Only after successful verification should the parsed `req.body` be passed into Zod for schema validation.

Even with correct signature verification, implementing idempotency keys is essential. This prevents duplicate processing of the same event, especially during retries or network issues.

Secure webhook processing demands strict control over the request body's lifecycle; never trust a parsed body for signature verification.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [AI Developer Tools: 🚀 AI - GPU and Memory Bandwidth](https://github.com/Drix10/ai-resources/blob/main/AI%20Developer%20Tools/resources-281.md)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/intent-canvas running or compiling.
- **First Comment**: Check out the code & architecture on GitHub → https://github.com/Drix10/intent-canvas
Personal blog & deep-dives: https://blogs.drix10.com
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
