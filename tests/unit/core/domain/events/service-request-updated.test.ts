import { describe, expect, it } from "vitest";

import { ServiceRequestUpdated } from "@/domain/events/service-request-updated";

describe("domain/events/service-request-updated", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(ServiceRequestUpdated.eventName).toBe("service_request.updated");
  });

  it("carries the request id and its post-update status", () => {
    const event = new ServiceRequestUpdated("request-1", "PUBLISHED");
    expect(event.serviceRequestId).toBe("request-1");
    expect(event.status).toBe("PUBLISHED");
  });
});
