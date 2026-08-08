import { describe, expect, it, vi } from "vitest";

import { TwilioSmsSender } from "@/infrastructure/sms/twilio-sms-sender";

function fakeResponse(ok: boolean, status: number, text: string): Response {
  return { ok, status, text: async () => text } as Response;
}

describe("TwilioSmsSender", () => {
  it("POSTs to the Messages.json endpoint with HTTP Basic Auth and form-encoded body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(true, 201, "{}"));
    const sender = new TwilioSmsSender("ACxxx", "authtoken", "+15550001111", fetchImpl);

    await sender.send({ to: "+34600000000", body: "hello" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages.json");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("ACxxx:authtoken").toString("base64")}`,
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe("+34600000000");
    expect(body.get("From")).toBe("+15550001111");
    expect(body.get("Body")).toBe("hello");
  });

  it("throws with the HTTP status and response body on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(false, 400, '{"message":"Invalid phone number"}'));
    const sender = new TwilioSmsSender("ACxxx", "authtoken", "+15550001111", fetchImpl);

    await expect(sender.send({ to: "invalid", body: "hi" })).rejects.toThrow(/HTTP 400/);
    await expect(sender.send({ to: "invalid", body: "hi" })).rejects.toThrow(/Invalid phone number/);
  });
});
