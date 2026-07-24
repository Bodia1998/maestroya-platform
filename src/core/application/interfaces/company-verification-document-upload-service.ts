/** Module 18 — Company Professional: upload port for CompanyVerification
 *  documents — mirrors VerificationDocumentUploadService (Module 17)
 *  exactly, kept as its own interface so this module's Cloudinary
 *  implementation can use a distinct, private folder from the individual-
 *  professional one without either module depending on the other. */
export interface CompanyVerificationDocumentUploadService {
  uploadCompanyVerificationDocument(verificationId: string, fileBuffer: Buffer, contentType: string): Promise<string>;
}
