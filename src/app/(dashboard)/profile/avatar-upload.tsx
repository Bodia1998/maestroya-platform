"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ALLOWED_AVATAR_MIME_TYPES } from "@/application/dto/profile.dto";
import { uploadAvatarAction } from "./actions";

export function AvatarUpload({ currentImageUrl }: { currentImageUrl: string | null }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputId = useId();
  const statusId = useId();

  // `useState(currentImageUrl)` above only ever consults its argument on
  // this component's *first* mount — an already-mounted instance ignores
  // later prop changes entirely. `currentImageUrl` only changes when the
  // parent Server Component re-renders with a fresh `profile.image`,
  // which in practice happens right after `uploadAvatarAction`'s
  // `revalidatePath("/profile")` following a successful upload. Without
  // this effect, the component kept showing whichever preview it
  // started with (or the optimistic local blob set below) forever, even
  // once the server confirmed the real, persisted image URL. Depending
  // only on `currentImageUrl` means this runs exactly once per genuine
  // server-confirmed change — never on every render, and never in a
  // loop, since nothing in this effect feeds back into its own
  // dependency.
  useEffect(() => {
    setPreviewUrl(currentImageUrl);
  }, [currentImageUrl]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setSuccess(false);
  }

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose an image first.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData();
    formData.set("avatar", file);
    const result = await uploadAvatarAction(formData);

    setIsUploading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSuccess(true);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="h-20 w-20 overflow-hidden rounded-full bg-black/5" aria-hidden={!previewUrl}>
        {previewUrl && (
          <Image
            src={previewUrl}
            alt="Your avatar"
            width={80}
            height={80}
            className="h-full w-full object-cover"
            unoptimized={previewUrl.startsWith("blob:")}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId} className="sr-only">
          Choose an avatar image
        </Label>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept={ALLOWED_AVATAR_MIME_TYPES.join(",")}
          onChange={handleFileChange}
          aria-describedby={error || success ? statusId : undefined}
          className="text-sm"
        />
        <Button type="button" size="sm" disabled={isUploading} onClick={handleUpload}>
          {isUploading ? "Uploading…" : "Upload avatar"}
        </Button>
        <div id={statusId} aria-live="polite">
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          {success && <p role="status" className="text-xs text-success">Avatar updated.</p>}
        </div>
      </div>
    </div>
  );
}
