"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ALLOWED_AVATAR_MIME_TYPES } from "@/application/dto/profile.dto";
import { uploadAvatarAction } from "./actions";

export function AvatarUpload({ currentImageUrl }: { currentImageUrl: string | null }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      <div className="h-20 w-20 overflow-hidden rounded-full bg-black/5">
        {previewUrl && (
          <Image
            src={previewUrl}
            alt="Avatar preview"
            width={80}
            height={80}
            className="h-full w-full object-cover"
            unoptimized={previewUrl.startsWith("blob:")}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_AVATAR_MIME_TYPES.join(",")}
          onChange={handleFileChange}
          className="text-sm"
        />
        <Button type="button" size="sm" disabled={isUploading} onClick={handleUpload}>
          {isUploading ? "Uploading…" : "Upload avatar"}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-xs text-green-700">
            Avatar updated.
          </p>
        )}
      </div>
    </div>
  );
}
