export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * Port for sending transactional email. Use cases depend on this
 * interface, never on a concrete provider — matches the pattern
 * documented in docs/ARCHITECTURE.md for PaymentGateway/FileStorage.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
