-- Sliding window rate limiter using Redis
-- KEYS[1]: rate limit key (e.g. "rl:user:uuid:chat/stream")
-- ARGV[1]: window size in seconds
-- ARGV[2]: max requests allowed in window
-- Returns: {allowed (1/0), current_count, ttl_ms}

local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, window)
end

local ttl = redis.call('TTL', key)
local allowed = current <= limit and 1 or 0
local remaining = math.max(0, limit - current)

return {allowed, remaining, ttl * 1000}
