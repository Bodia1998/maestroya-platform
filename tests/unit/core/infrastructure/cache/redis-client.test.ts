import { afterEach, describe, expect, it } from "vitest";

import { RedisClient, parseRedisUrl } from "@/infrastructure/cache/redis-client";
import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";

describe("infrastructure/cache/redis-client: parseRedisUrl", () => {
  it("parses host, default port, and default db from a bare redis:// URL", () => {
    expect(parseRedisUrl("redis://localhost")).toEqual({
      host: "localhost",
      port: 6379,
      password: null,
      db: 0,
      tls: false,
    });
  });

  it("parses an explicit port, password, and db index", () => {
    expect(parseRedisUrl("redis://:s3cret@cache.example.com:6380/3")).toEqual({
      host: "cache.example.com",
      port: 6380,
      password: "s3cret",
      db: 3,
      tls: false,
    });
  });

  it("recognizes rediss:// as TLS", () => {
    expect(parseRedisUrl("rediss://cache.example.com").tls).toBe(true);
  });

  it("rejects an unsupported scheme", () => {
    expect(() => parseRedisUrl("http://cache.example.com")).toThrow(/Unsupported Redis URL scheme/);
  });

  it("rejects a non-numeric db path segment", () => {
    expect(() => parseRedisUrl("redis://localhost/not-a-number")).toThrow(/Invalid Redis DB index/);
  });
});

describe("infrastructure/cache/redis-client: RedisClient (against a fake RESP2 server)", () => {
  let server: FakeRedisServer;

  afterEach(async () => {
    await server?.close();
  });

  it("connects lazily and completes a PING round trip", async () => {
    server = await startFakeRedisServer();
    const client = new RedisClient({ url: server.url });

    await expect(client.command(["PING"])).resolves.toBe("PONG");
  });

  it("sets and gets a value", async () => {
    server = await startFakeRedisServer();
    const client = new RedisClient({ url: server.url });

    await expect(client.command(["SET", "k1", "v1"])).resolves.toBe("OK");
    await expect(client.command(["GET", "k1"])).resolves.toBe("v1");
  });

  it("returns null for a missing key", async () => {
    server = await startFakeRedisServer();
    const client = new RedisClient({ url: server.url });

    await expect(client.command(["GET", "does-not-exist"])).resolves.toBeNull();
  });

  it("performs AUTH before the first user command when the URL has a password", async () => {
    server = await startFakeRedisServer();
    const client = new RedisClient({ url: `redis://:secret@127.0.0.1:${server.port}` });

    await expect(client.command(["PING"])).resolves.toBe("PONG");
  });

  it("surfaces a server-side AUTH failure as a rejected promise", async () => {
    server = await startFakeRedisServer({ rejectAuth: true });
    const client = new RedisClient({ url: `redis://:wrong@127.0.0.1:${server.port}` });

    await expect(client.command(["PING"])).rejects.toThrow(/WRONGPASS/);
  });

  it("rejects with the server's RESP error message for an unknown command", async () => {
    server = await startFakeRedisServer();
    const client = new RedisClient({ url: server.url });

    await expect(client.command(["NOTACOMMAND"])).rejects.toThrow(/unknown command/);
  });

  it("keeps replies matched to the correct pending command under pipelined (overlapping) calls", async () => {
    server = await startFakeRedisServer();
    const client = new RedisClient({ url: server.url });

    await client.command(["SET", "a", "1"]);
    await client.command(["SET", "b", "2"]);

    // Fire both without awaiting the first — RESP guarantees ordered
    // replies on one connection, so these must resolve to the right values.
    const [a, b] = await Promise.all([client.command(["GET", "a"]), client.command(["GET", "b"])]);
    expect(a).toBe("1");
    expect(b).toBe("2");
  });

  it("rejects a command that times out and tears down the connection (does not hang forever)", async () => {
    server = await startFakeRedisServer({ hangOnCommand: "PING" });
    const client = new RedisClient({ url: server.url, commandTimeoutMs: 50, connectTimeoutMs: 500 });

    await expect(client.command(["PING"])).rejects.toThrow(/timed out/);
  });

  it("rejects when the server is unreachable within the connect timeout", async () => {
    // Port 1 is a reserved, never-listening port — connection attempts
    // there are refused essentially immediately, which is enough to
    // exercise the connect-timeout/error path without a real hang.
    const client = new RedisClient({ url: "redis://127.0.0.1:1", connectTimeoutMs: 300 });
    await expect(client.command(["PING"])).rejects.toBeInstanceOf(Error);
  });

  it("quit() is a safe no-op when never connected", async () => {
    const client = new RedisClient({ url: "redis://127.0.0.1:1" });
    await expect(client.quit()).resolves.toBeUndefined();
  });
});
