// Classic token bucket rate limiter, one bucket per API key.
//
// Each bucket holds up to `capacity` tokens. Tokens refill continuously at
// `refillPerSecond`. Every request costs 1 token. If a bucket is empty,
// the request is rejected — this allows short bursts (up to `capacity`)
// while still enforcing a steady average rate over time.

export class TokenBucketLimiter {
  constructor({ capacity = 10, refillPerSecond = 5 } = {}) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    // apiKey -> { tokens, lastRefillTime }
    this.buckets = new Map();
  }

  _getBucket(apiKey) {
    let bucket = this.buckets.get(apiKey);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillTime: Date.now() };
      this.buckets.set(apiKey, bucket);
    }
    return bucket;
  }

  _refill(bucket) {
    const now = Date.now();
    const elapsedSeconds = (now - bucket.lastRefillTime) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillPerSecond;

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefillTime = now;
    }
  }

  // Returns true if the request is allowed (and consumes a token).
  // Returns false if the bucket is empty (request should be rejected).
  tryConsume(apiKey) {
    const bucket = this._getBucket(apiKey);
    this._refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  getRemainingTokens(apiKey) {
    const bucket = this._getBucket(apiKey);
    this._refill(bucket);
    return Math.floor(bucket.tokens);
  }
}