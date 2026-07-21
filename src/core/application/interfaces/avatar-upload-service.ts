export interface AvatarUploadService {
  /** Uploads image bytes and returns the public URL to store on User.image. */
  uploadAvatar(userId: string, fileBuffer: Buffer, contentType: string): Promise<string>;
}
