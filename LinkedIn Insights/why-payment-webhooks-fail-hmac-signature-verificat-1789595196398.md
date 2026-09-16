# Why Payment Webhooks Fail HMAC Signature Verification


![Why Payment Webhooks Fail HMAC Signature Verification](/slides/why-payment-webhooks-fail-hmac-signature-verificat-1789595196398.png)

Payment webhooks silently fail HMAC signature verification when express.json() middleware parses the body before hashing. This is because express.json() middleware captures the mutable request body, making it impossible to verify the immutable raw body for HMAC signature verification.

When I built the intent-canvas webhook system, I ran into a weird bug where payment webhooks silently failed HMAC signature verification. The issue was that express.json() middleware was parsing the body before hashing, making it impossible to verify the immutable raw body for HMAC signature verification.

To fix this issue, we need to capture the immutable binary Buffer via express.json({ verify: (req, res, buf) => req.rawBody = buf }) and then verify HMAC using crypto.createHmac and crypto.timingSafeEqual. Only then can we pass req.body into Zod schema validation.

Here's the exact fix:

By preserving the immutable raw body, we can ensure the integrity of payment webhooks and prevent silent failures due to HMAC signature verification issues.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [AI Developer Tools: 🚀 AI Model Efficiency - Zero-Shot Sequence Classification](https://github.com/Drix10/ai-resources/blob/main/AI%20Developer%20Tools/resources-266.md)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/intent-canvas running or compiling.
- **First Comment**: Check out the code & architecture on GitHub → https://github.com/Drix10/intent-canvas
Personal blog & deep-dives: https://blogs.drix10.com
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
