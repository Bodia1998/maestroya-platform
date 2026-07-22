"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ALLOWED_REQUEST_PHOTO_MIME_TYPES, MAX_PHOTOS_PER_REQUEST } from "@/application/dto/service-request.dto";
import { addServiceRequestPhotoAction, removeServiceRequestPhotoAction } from "../actions";

interface PhotoLike {
  id: string;
  url: string;
  caption: string | null;
}

/**
 * Photo upload/removal for a single ServiceRequest, following the same
 * client-side pattern as AvatarUpload (profile module): pick a file,
 * submit as FormData to a Server Action, let the action re-check
 * type/size server-side and hand off to the Cloudinary-backed use case.
 * Only rendered while the request is editable (PUBLISHED) — the page
 * deciding whether to show this is responsible for that, and the
 * underlying use cases enforce it again regardless.
 */
export function ServiceRequestPhotoManager({
  requestId,
  photos,
  editable,
}: {
  requestId: string;
  photos: PhotoLike[];
  editable: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose an image first.");
      return;
    }

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.set("photo", file);
    const result = await addServiceRequestPhotoAction(requestId, formData);

    setIsUploading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleRemove(photoId: string) {
    setRemovingId(photoId);
    setError(null);
    const result = await removeServiceRequestPhotoAction(requestId, photoId);
    setRemovingId(null);
    if (!result.success) {
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="relative aspect-square overflow-hidden rounded-md bg-black/5">
              <Image src={photo.url} alt={photo.caption ?? "Request photo"} fill className="object-cover" />
              {editable && (
                <button
                  type="button"
                  onClick={() => handleRemove(photo.id)}
                  disabled={removingId === photo.id}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white hover:bg-black/80"
                >
                  {removingId === photo.id ? "…" : "Remove"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {photos.length === 0 && <p className="text-sm text-foreground/70">No photos attached.</p>}

      {editable && (
        <div className="flex flex-col gap-2">
          {photos.length < MAX_PHOTOS_PER_REQUEST ? (
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_REQUEST_PHOTO_MIME_TYPES.join(",")}
                className="text-sm"
              />
              <Button type="button" size="sm" disabled={isUploading} onClick={handleUpload}>
                {isUploading ? "Uploading…" : "Add photo"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-foreground/70">
              Maximum of {MAX_PHOTOS_PER_REQUEST} photos reached.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
