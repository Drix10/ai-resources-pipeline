# WebSocket Heartbeats: Preventing Silent Mobile Disconnects with Redis Pub/Sub


![WebSocket Heartbeats: Preventing Silent Mobile Disconnects with Redis Pub/Sub](/slides/websocket-heartbeats-preventing-silent-mobile-disc-1790098474390.png)

Mobile WebSocket clients frequently disconnect without `onclose` events. This silent failure mode breaks real-time applications, leaving users with stale data and missed messages.

In `idolchat`, I ran into this exact issue while building out the real-time chat layer. Mobile network handoffs or backgrounding the app would often drop WebSocket connections without any server-side notification.

To fix this, I implemented application-level ping/pong heartbeats. Every 30 seconds, the server sends a `ping` frame to the client. If the client doesn't respond with a `pong` within a set timeout, like 5 seconds, the server explicitly terminates the connection.

This forced termination is crucial. It ensures the `onclose` handler fires, allowing proper cleanup of resources and accurate state synchronization for the user's session.

Scaling this across multiple WebSocket servers introduced another challenge: maintaining consistent user presence. A silent disconnect detected by one server needed to be known by all others.

Redis Pub/Sub became critical here. When a server detects a silent disconnect via a missed heartbeat, it publishes a "disconnect" event to a dedicated Redis channel. All other WebSocket servers, and even background workers, subscribe to this channel.

Subscribing servers can then update user presence, invalidate caches, and prevent messages from being routed to a dead connection. This approach prevents message dropouts and mitigates Prisma schema write bottlenecks by offloading real-time state management to Redis, avoiding unnecessary database hits for stale connections.

Reliable real-time systems demand explicit application-level liveness checks and a distributed state synchronization layer, not just network-level assumptions.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [Tech Infrastructure: 📊 Structured Receipt Extraction](https://github.com/Drix10/ai-resources/blob/main/Tech%20Infrastructure/resources-253.md)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/idolchat running or compiling.
- **First Comment**: Check out the code & architecture on GitHub → https://github.com/Drix10/idolchat
Personal blog & deep-dives: https://blogs.drix10.com
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
