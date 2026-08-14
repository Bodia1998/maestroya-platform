import { describe, expect, it } from "vitest";

import { detectOffPlatformSignals, hasHighConfidenceSignal } from "@/domain/services/off-platform-detection-rules";

describe("Module 65 — detectOffPlatformSignals", () => {
  it("returns an empty array for ordinary marketplace text", () => {
    expect(detectOffPlatformSignals("The bathroom tiling looks great, thank you!")).toEqual([]);
  });

  it("returns an empty array for empty/whitespace input", () => {
    expect(detectOffPlatformSignals("")).toEqual([]);
    expect(detectOffPlatformSignals("   ")).toEqual([]);
  });

  it("detects a WhatsApp mention", () => {
    const signals = detectOffPlatformSignals("add me on whatsapp please");
    expect(signals.some((s) => s.channel === "WHATSAPP")).toBe(true);
  });

  it("detects a Telegram mention", () => {
    const signals = detectOffPlatformSignals("find me on telegram @user");
    expect(signals.some((s) => s.channel === "TELEGRAM")).toBe(true);
  });

  it("detects a phone number pattern", () => {
    const signals = detectOffPlatformSignals("call me at 611 222 333");
    expect(signals.some((s) => s.channel === "PHONE_NUMBER")).toBe(true);
  });

  it("detects an obfuscated email address", () => {
    const signals = detectOffPlatformSignals("email me at john (at) example (dot) com");
    expect(signals.some((s) => s.channel === "EMAIL_ADDRESS")).toBe(true);
  });

  it("detects an external payment request", () => {
    const signals = detectOffPlatformSignals("just pay me directly in cash");
    expect(signals.some((s) => s.channel === "EXTERNAL_PAYMENT_REQUEST")).toBe(true);
  });

  it("detects a contact-exchange phrase", () => {
    const signals = detectOffPlatformSignals("let's continue outside the platform");
    expect(signals.some((s) => s.channel === "CONTACT_EXCHANGE_PHRASE")).toBe(true);
  });

  it("detects multiple distinct channels in one message", () => {
    const signals = detectOffPlatformSignals("Contact me on WhatsApp or Telegram, +34 611222333");
    const channels = new Set(signals.map((s) => s.channel));
    expect(channels.has("WHATSAPP")).toBe(true);
    expect(channels.has("TELEGRAM")).toBe(true);
  });

  it("truncates matchedText to 200 characters", () => {
    const longText = "whatsapp " + "x".repeat(500);
    const signals = detectOffPlatformSignals(longText);
    for (const signal of signals) {
      expect(signal.matchedText.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("Module 65 — hasHighConfidenceSignal", () => {
  it("is false for an empty signal list", () => {
    expect(hasHighConfidenceSignal([])).toBe(false);
  });

  it("is true when at least one signal has confidence >= 75", () => {
    expect(hasHighConfidenceSignal([{ channel: "WHATSAPP", matchedText: "whatsapp", confidence: 90 }])).toBe(true);
  });

  it("is false when every signal is below the threshold", () => {
    expect(hasHighConfidenceSignal([{ channel: "SIGNAL", matchedText: "signal", confidence: 60 }])).toBe(false);
  });
});
