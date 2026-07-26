import "server-only";

import { v2 as cloudinary } from "cloudinary";

import { env } from "@/infrastructure/config/env";

/**
 * Cloudinary SDK configuration — server-side only (e.g. signed upload
 * generation, deletion). Client-side uploads/rendering should go through
 * `next-cloudinary` components, configured separately with the public
 * cloud name only.
 */
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };
