import { describe, expect, it } from "vitest";

import type { ConversationStatusValue } from "@/domain/repositories/conversation-repository";
import { canSendMessage } from "@/domain/services/conversation-state";

const ALL_STATUSES: ConversationStatusValue[] = ["ACTIVE", "ARCHIVED", "CLOSED"];

describe("conversation-state", () => {
  it("only allows sending new messages while ACTIVE", () => {
    expect(canSendMessage("ACTIVE")).toBe(true);
    expect(canSendMessage("ARCHIVED")).toBe(false);
    expect(canSendMessage("CLOSED")).toBe(false);
  });

  it("has no status other than ACTIVE that permits sending", () => {
    for (const status of ALL_STATUSES) {
      expect(canSendMessage(status)).toBe(status === "ACTIVE");
    }
  });
});
