import { redis } from "@/app/lib/redis";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");

  if (!key || !key.trim()) {
    return NextResponse.json({ error: "Key is required" }, { status: 400 });
  }

  const redisKey = `content:${key.trim()}`;
  const content = await redis.get<string>(redisKey);

  return NextResponse.json({
    content,
    exists: content !== null,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, content } = body;

  if (!key || !key.trim()) {
    return NextResponse.json({ error: "Key is required" }, { status: 400 });
  }

  if (content === undefined) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  const redisKey = `content:${key.trim()}`;
  await redis.set(redisKey, content);

  return NextResponse.json({ success: true });
}
