# Why Payment Webhooks Fail HMAC Signature Verification


![Why Payment Webhooks Fail HMAC Signature Verification](/slides/why-payment-webhooks-fail-hmac-signature-verificat-1789905955388.png)

When I built the payment webhook system for intent-canvas, I ran into a weird bug where HMAC signature verification silently failed. This is because express.json() middleware parses the body before hashing, capturing the mutable request body and making it impossible to verify the immutable raw body HMAC signature.

To fix this issue, I captured the immutable binary Buffer via express.json({ verify: (req, res, buf) => req.rawBody = buf }), verified HMAC using crypto.createHmac and crypto.timingSafeEqual, and only then passed req.body into Zod schema validation.

Always capture the immutable raw body Buffer before parsing the request body. Use crypto.createHmac and crypto.timingSafeEqual to verify HMAC signatures. Pass req.body into Zod schema validation only after verifying HMAC signatures.

By following these steps, you can ensure that payment webhooks successfully verify HMAC signatures and prevent silent failures.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [AI Developer Tools: 🤖 AI Engineering - Key Identity Management Considerations](https://github.com/Drix10/ai-resources/blob/main/AI%20Developer%20Tools/resources-273.md)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/intent-canvas running or compiling.
- **First Comment**: Check out the code & architecture on GitHub → https://github.com/Drix10/intent-canvas
Personal blog & deep-dives: https://blogs.drix10.com
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
