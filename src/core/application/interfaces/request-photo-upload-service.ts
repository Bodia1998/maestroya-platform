export interface RequestPhotoUploadService {
  /** Uploads image bytes for a ServiceRequest and returns the public URL to store on RequestPhoto.url. */
  uploadRequestPhoto(serviceRequestId: string, fileBuffer: Buffer, contentType: string): Promise<string>;
}
