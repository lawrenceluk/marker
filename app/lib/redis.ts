import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
  // Notes are opaque text, not JSON. Left on, the client would JSON.parse
  // replies, so a note containing `123` or `{"a":1}` would come back as a
  // number or an object instead of the string that was stored.
  automaticDeserialization: false,
});
