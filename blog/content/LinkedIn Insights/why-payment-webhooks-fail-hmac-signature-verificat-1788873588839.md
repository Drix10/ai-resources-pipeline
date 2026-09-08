# Why Payment Webhooks Fail HMAC Signature Verification


![Why Payment Webhooks Fail HMAC Signature Verification](/slides/why-payment-webhooks-fail-hmac-signature-verificat-1788873588839.png)

When Dodo Payments webhooks fail HMAC signature verification, it's often due to Express JSON middleware parsing the request body before hashing, leaving raw request buffers vulnerable to tampering.

I ran into this weird bug when building the intent-canvas repository, and it took me a while to figure out the root cause.

In my codebase, I use Express JSON middleware to parse incoming request bodies, but this middleware consumes the raw body stream before I can hash it for HMAC signature verification.

This breaks the entire security mechanism, allowing attackers to tamper with the request body and bypass verification.

To fix this issue, I started using Zod validation pipelines to validate request bodies before Express JSON middleware parses them.

This ensures that only valid requests are processed, preventing tampering and ensuring secure HMAC signature verification.

Here's the exact mechanism: I use Zod to validate the request body against a predefined schema, and only if the validation passes, I let Express JSON middleware parse the request body.

This way, I preserve the raw request buffers and prevent tampering.

By using Zod validation pipelines, I can ensure secure HMAC signature verification and prevent payment webhooks from failing due to tampering.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [Drix10/intent-canvas: Visual Workspace Mapping Natural Language to Agent Graphs](https://github.com/Drix10/intent-canvas)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/intent-canvas running or compiling.
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
