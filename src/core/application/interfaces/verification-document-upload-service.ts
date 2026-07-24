export interface VerificationDocumentUploadService {
  /**
   * Uploads verification-document bytes for a given verification case and
   * returns the (secure) URL to store on
   * ProfessionalVerificationDocument.fileUrl. The returned URL is sensitive
   * personal data — callers must never surface it on a public response (see
   * the module's use cases / docs).
   */
  uploadVerificationDocument(
    verificationId: string,
    fileBuffer: Buffer,
    contentType: string,
  ): Promise<string>;
}
