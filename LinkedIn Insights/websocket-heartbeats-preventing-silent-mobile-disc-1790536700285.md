# WebSocket Heartbeats: Preventing Silent Mobile Disconnects with Redis Pub/Sub


![WebSocket Heartbeats: Preventing Silent Mobile Disconnects with Redis Pub/Sub](/slides/websocket-heartbeats-preventing-silent-mobile-disc-1790536700285.png)

Mobile WebSocket clients drop connections silently. Your `onclose` handler will not fire. This leads to stale state and missed messages in real-time applications.

In `idolchat`, I encountered this exact problem. Mobile OS power optimizations would terminate WebSocket connections without the server-side `onclose` event ever firing, leaving ghost connections.

To combat this, I implemented a server-initiated 30-second ping/pong heartbeat system. This actively verifies client liveness. If a client fails to respond to a ping within the timeout, the server explicitly closes the connection. This ensures detection of unresponsive clients.

For scaling message delivery across multiple WebSocket servers, I integrated Redis Pub/Sub. This decouples message broadcasting from individual server instances. It prevents message loss and offloads state synchronization.

Using Redis Pub/Sub also avoids direct database write bottlenecks with Prisma for every message. All active server instances receive and forward messages efficiently.

Building `idolchat` taught me that reliable real-time systems on mobile demand active connection management, not passive event listening.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [Tech Infrastructure: 📊 Performance Engineering Category - The Limits of P99 Metrics](https://github.com/Drix10/ai-resources/blob/main/Tech%20Infrastructure/resources-258.md)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/idolchat running or compiling.
- **First Comment**: Check out the code & architecture on GitHub → https://github.com/Drix10/idolchat
Personal blog & deep-dives: https://blogs.drix10.com
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
