interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const ipMap = new Map<string, RateLimitEntry>();
const MAX_TRACKED_IPS = 10000;

// Periodic cleanup to avoid memory leaks (TypeScript safe forEach)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    ipMap.forEach((entry, ip) => {
      if (now > entry.resetTime) {
        ipMap.delete(ip);
      }
    });
  }, 60000).unref?.();
}

export function checkRateLimit(
  identifier: string,
  maxRequests = 60,
  windowMs = 60000
): { allowed: boolean; remaining: number } {
  const ip = identifier || 'anonymous';
  const now = Date.now();

  let entry = ipMap.get(ip);
  if (!entry || now > entry.resetTime) {
    if (ipMap.size >= MAX_TRACKED_IPS) {
      ipMap.clear(); // Safety purge under massive DDoS load
    }
    entry = { count: 1, resetTime: now + windowMs };
    ipMap.set(ip, entry);
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return '127.0.0.1';
}
