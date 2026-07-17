-- ============================================================================
-- IMPORTANT — READ BEFORE APPLYING
-- ============================================================================
-- This migration was hand-authored to mirror what `npx prisma migrate dev`
-- would generate from prisma/schema.prisma. It was NOT produced or verified
-- by the actual Prisma migration engine — the sandbox this was written in
-- has no network access, so the engine binaries could not be downloaded.
--
-- Do not treat this as authoritative. Once you have this repo locally:
--   1. Delete this hand-written migration.sql (keep the folder empty or
--      remove the folder entirely).
--   2. Run `npx prisma migrate dev --name init_domain_model` against a real
--      Postgres instance. Prisma will generate and apply the verified,
--      engine-checked version of this file from schema.prisma directly.
-- The version below is provided so you have a complete, readable reference
-- of the intended DDL (including the CHECK constraints, which Prisma's
-- schema language cannot express and must live in a migration regardless
-- of who/what generates the surrounding file) while you don't yet have a
-- database to run the real command against.
-- ============================================================================

-- ============================================================================
-- CreateEnum
-- ============================================================================
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED');
CREATE TYPE "CompanyMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "AddressType" AS ENUM ('HOME', 'WORK', 'BILLING', 'SERVICE_LOCATION', 'OTHER');
CREATE TYPE "ServiceCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "RequestUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY');
CREATE TYPE "ServiceRequestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'QUOTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED');
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'CLOSED');
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'DELETED');
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FLAGGED', 'REMOVED');
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'SEPA_DEBIT', 'BANK_TRANSFER', 'WALLET', 'OTHER');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "TransactionType" AS ENUM ('CHARGE', 'REFUND', 'PAYOUT', 'COMMISSION', 'ADJUSTMENT');
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'INVOICED', 'SETTLED', 'WAIVED');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELLED');
CREATE TYPE "RefundReason" AS ENUM ('DUPLICATE', 'FRAUDULENT', 'REQUESTED_BY_CUSTOMER', 'SERVICE_NOT_RENDERED', 'QUALITY_ISSUE', 'OTHER');
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSED', 'FAILED');
CREATE TYPE "NotificationType" AS ENUM ('SERVICE_REQUEST_UPDATE', 'QUOTE_RECEIVED', 'QUOTE_ACCEPTED', 'APPOINTMENT_REMINDER', 'MESSAGE_RECEIVED', 'PAYMENT_RECEIVED', 'PAYOUT_PROCESSED', 'REVIEW_RECEIVED', 'DISPUTE_UPDATE', 'SYSTEM', 'MARKETING');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ');
CREATE TYPE "VerificationDocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE', 'BUSINESS_LICENSE', 'TAX_CERTIFICATE', 'INSURANCE_CERTIFICATE', 'PROFESSIONAL_CERTIFICATION', 'PROOF_OF_ADDRESS', 'OTHER');
CREATE TYPE "VerificationDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');
CREATE TYPE "DisputeReason" AS ENUM ('SERVICE_NOT_COMPLETED', 'QUALITY_ISSUE', 'BILLING_ISSUE', 'DAMAGE_CLAIM', 'BEHAVIOR_ISSUE', 'OTHER');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'ESCALATED', 'CLOSED');
CREATE TYPE "DisputeResolution" AS ENUM ('REFUND_CUSTOMER', 'PAY_PROFESSIONAL', 'PARTIAL_REFUND', 'NO_ACTION', 'ESCALATED_EXTERNALLY');
CREATE TYPE "AuditLogAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'STATUS_CHANGE', 'PAYMENT', 'PAYOUT', 'VERIFICATION', 'OTHER');

-- ============================================================================
-- CreateTable — Auth.js models
-- ============================================================================
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "phone" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "preferredLanguageId" UUID,
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- ============================================================================
-- CreateTable — Reference data
-- ============================================================================
CREATE TABLE "languages" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nativeName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Identity & Profiles
-- ============================================================================
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "AddressType" NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'ES',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "defaultAddressId" UUID,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "professional_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "bio" TEXT,
    "headline" TEXT,
    "yearsExperience" INTEGER,
    "hourlyRate" DECIMAL(10,2),
    "serviceRadiusKm" INTEGER,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "stripeConnectAccountId" TEXT,
    "averageRating" DECIMAL(3,2),
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "isAcceptingRequests" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "professional_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company_profiles" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "taxId" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "stripeConnectAccountId" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "averageRating" DECIMAL(3,2),
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "isAcceptingRequests" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company_members" (
    "id" UUID NOT NULL,
    "companyProfileId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CompanyMemberRole" NOT NULL DEFAULT 'MEMBER',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Service Catalog
-- ============================================================================
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "status" "ServiceCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Requests, Quotes & Scheduling
-- ============================================================================
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "addressId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "urgency" "RequestUrgency" NOT NULL DEFAULT 'MEDIUM',
    "budgetMin" DECIMAL(10,2),
    "budgetMax" DECIMAL(10,2),
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "request_photos" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "request_photos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "professionalProfileId" UUID,
    "companyProfileId" UUID,
    "submittedByUserId" UUID NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_items" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "addressId" UUID NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Messaging
-- ============================================================================
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_members" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Reviews
-- ============================================================================
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "revieweeProfessionalProfileId" UUID,
    "revieweeCompanyProfileId" UUID,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Payments & Finance
-- ============================================================================
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "quoteId" UUID,
    "payerId" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "method" "PaymentMethodType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripePaymentIntentId" TEXT,
    "capturedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "professionalProfileId" UUID,
    "companyProfileId" UUID,
    "rateBps" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "professionalProfileId" UUID,
    "companyProfileId" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "stripeTransferId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "stripeRefundId" TEXT,
    "processedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "paymentId" UUID,
    "payoutId" UUID,
    "refundId" UUID,
    "commissionId" UUID,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Notifications
-- ============================================================================
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Trust & Safety
-- ============================================================================
CREATE TABLE "verification_documents" (
    "id" UUID NOT NULL,
    "professionalProfileId" UUID,
    "companyProfileId" UUID,
    "type" "VerificationDocumentType" NOT NULL,
    "status" "VerificationDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "raisedByUserId" UUID NOT NULL,
    "respondentProfessionalProfileId" UUID,
    "respondentCompanyProfileId" UUID,
    "reason" "DisputeReason" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "DisputeResolution",
    "description" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dispute_evidence" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "submittedByUserId" UUID NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — Platform / Audit
-- ============================================================================
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "action" "AuditLogAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable — implicit many-to-many join tables
-- ============================================================================
CREATE TABLE "_ProfessionalCategories" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

CREATE TABLE "_CompanyCategories" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

CREATE TABLE "_ProfessionalLanguages" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- ============================================================================
-- CreateIndex
-- ============================================================================
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
CREATE INDEX "users_preferredLanguageId_idx" ON "users"("preferredLanguageId");

CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");

CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");
CREATE INDEX "addresses_deletedAt_idx" ON "addresses"("deletedAt");

CREATE UNIQUE INDEX "customer_profiles_userId_key" ON "customer_profiles"("userId");
CREATE INDEX "customer_profiles_defaultAddressId_idx" ON "customer_profiles"("defaultAddressId");
CREATE INDEX "customer_profiles_deletedAt_idx" ON "customer_profiles"("deletedAt");

CREATE UNIQUE INDEX "professional_profiles_userId_key" ON "professional_profiles"("userId");
CREATE UNIQUE INDEX "professional_profiles_stripeConnectAccountId_key" ON "professional_profiles"("stripeConnectAccountId");
CREATE INDEX "professional_profiles_isVerified_idx" ON "professional_profiles"("isVerified");
CREATE INDEX "professional_profiles_isAcceptingRequests_idx" ON "professional_profiles"("isAcceptingRequests");
CREATE INDEX "professional_profiles_deletedAt_idx" ON "professional_profiles"("deletedAt");

CREATE UNIQUE INDEX "company_profiles_taxId_key" ON "company_profiles"("taxId");
CREATE UNIQUE INDEX "company_profiles_stripeConnectAccountId_key" ON "company_profiles"("stripeConnectAccountId");
CREATE INDEX "company_profiles_ownerUserId_idx" ON "company_profiles"("ownerUserId");
CREATE INDEX "company_profiles_isVerified_idx" ON "company_profiles"("isVerified");
CREATE INDEX "company_profiles_deletedAt_idx" ON "company_profiles"("deletedAt");

CREATE UNIQUE INDEX "company_members_companyProfileId_userId_key" ON "company_members"("companyProfileId", "userId");
CREATE INDEX "company_members_userId_idx" ON "company_members"("userId");
CREATE INDEX "company_members_companyProfileId_removedAt_idx" ON "company_members"("companyProfileId", "removedAt");

CREATE UNIQUE INDEX "service_categories_slug_key" ON "service_categories"("slug");
CREATE INDEX "service_categories_parentId_idx" ON "service_categories"("parentId");
CREATE INDEX "service_categories_status_idx" ON "service_categories"("status");
CREATE INDEX "service_categories_deletedAt_idx" ON "service_categories"("deletedAt");

CREATE INDEX "service_requests_customerId_idx" ON "service_requests"("customerId");
CREATE INDEX "service_requests_categoryId_idx" ON "service_requests"("categoryId");
CREATE INDEX "service_requests_addressId_idx" ON "service_requests"("addressId");
CREATE INDEX "service_requests_status_categoryId_idx" ON "service_requests"("status", "categoryId");
CREATE INDEX "service_requests_createdAt_idx" ON "service_requests"("createdAt");
CREATE INDEX "service_requests_deletedAt_idx" ON "service_requests"("deletedAt");

CREATE INDEX "request_photos_serviceRequestId_idx" ON "request_photos"("serviceRequestId");

CREATE INDEX "quotes_serviceRequestId_status_idx" ON "quotes"("serviceRequestId", "status");
CREATE INDEX "quotes_professionalProfileId_idx" ON "quotes"("professionalProfileId");
CREATE INDEX "quotes_companyProfileId_idx" ON "quotes"("companyProfileId");
CREATE INDEX "quotes_submittedByUserId_idx" ON "quotes"("submittedByUserId");

CREATE INDEX "quote_items_quoteId_idx" ON "quote_items"("quoteId");

CREATE INDEX "appointments_quoteId_idx" ON "appointments"("quoteId");
CREATE INDEX "appointments_serviceRequestId_idx" ON "appointments"("serviceRequestId");
CREATE INDEX "appointments_addressId_idx" ON "appointments"("addressId");
CREATE INDEX "appointments_scheduledStart_idx" ON "appointments"("scheduledStart");
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

CREATE INDEX "conversations_serviceRequestId_idx" ON "conversations"("serviceRequestId");
CREATE INDEX "conversations_lastMessageAt_idx" ON "conversations"("lastMessageAt");

CREATE UNIQUE INDEX "conversation_members_conversationId_userId_key" ON "conversation_members"("conversationId", "userId");
CREATE INDEX "conversation_members_userId_idx" ON "conversation_members"("userId");

CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");
CREATE INDEX "messages_senderId_idx" ON "messages"("senderId");

CREATE INDEX "message_attachments_messageId_idx" ON "message_attachments"("messageId");

CREATE INDEX "reviews_serviceRequestId_idx" ON "reviews"("serviceRequestId");
CREATE INDEX "reviews_reviewerId_idx" ON "reviews"("reviewerId");
CREATE INDEX "reviews_revieweeProfessionalProfileId_idx" ON "reviews"("revieweeProfessionalProfileId");
CREATE INDEX "reviews_revieweeCompanyProfileId_idx" ON "reviews"("revieweeCompanyProfileId");
CREATE INDEX "reviews_status_idx" ON "reviews"("status");

CREATE UNIQUE INDEX "payments_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId");
CREATE INDEX "payments_serviceRequestId_idx" ON "payments"("serviceRequestId");
CREATE INDEX "payments_quoteId_idx" ON "payments"("quoteId");
CREATE INDEX "payments_payerId_idx" ON "payments"("payerId");
CREATE INDEX "payments_status_idx" ON "payments"("status");

CREATE UNIQUE INDEX "commissions_paymentId_key" ON "commissions"("paymentId");
CREATE INDEX "commissions_professionalProfileId_idx" ON "commissions"("professionalProfileId");
CREATE INDEX "commissions_companyProfileId_idx" ON "commissions"("companyProfileId");
CREATE INDEX "commissions_status_idx" ON "commissions"("status");

CREATE UNIQUE INDEX "payouts_stripeTransferId_key" ON "payouts"("stripeTransferId");
CREATE INDEX "payouts_professionalProfileId_idx" ON "payouts"("professionalProfileId");
CREATE INDEX "payouts_companyProfileId_idx" ON "payouts"("companyProfileId");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

CREATE UNIQUE INDEX "refunds_stripeRefundId_key" ON "refunds"("stripeRefundId");
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");
CREATE INDEX "refunds_requestedByUserId_idx" ON "refunds"("requestedByUserId");
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

CREATE INDEX "transactions_paymentId_idx" ON "transactions"("paymentId");
CREATE INDEX "transactions_payoutId_idx" ON "transactions"("payoutId");
CREATE INDEX "transactions_refundId_idx" ON "transactions"("refundId");
CREATE INDEX "transactions_commissionId_idx" ON "transactions"("commissionId");
CREATE INDEX "transactions_type_status_idx" ON "transactions"("type", "status");
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
CREATE INDEX "notifications_deletedAt_idx" ON "notifications"("deletedAt");

CREATE INDEX "verification_documents_professionalProfileId_idx" ON "verification_documents"("professionalProfileId");
CREATE INDEX "verification_documents_companyProfileId_idx" ON "verification_documents"("companyProfileId");
CREATE INDEX "verification_documents_reviewedByUserId_idx" ON "verification_documents"("reviewedByUserId");
CREATE INDEX "verification_documents_status_idx" ON "verification_documents"("status");

CREATE INDEX "disputes_serviceRequestId_idx" ON "disputes"("serviceRequestId");
CREATE INDEX "disputes_raisedByUserId_idx" ON "disputes"("raisedByUserId");
CREATE INDEX "disputes_resolvedByUserId_idx" ON "disputes"("resolvedByUserId");
CREATE INDEX "disputes_status_idx" ON "disputes"("status");
CREATE INDEX "disputes_respondentProfessionalProfileId_idx" ON "disputes"("respondentProfessionalProfileId");
CREATE INDEX "disputes_respondentCompanyProfileId_idx" ON "disputes"("respondentCompanyProfileId");

CREATE INDEX "dispute_evidence_disputeId_idx" ON "dispute_evidence"("disputeId");
CREATE INDEX "dispute_evidence_submittedByUserId_idx" ON "dispute_evidence"("submittedByUserId");

CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

CREATE UNIQUE INDEX "_ProfessionalCategories_AB_unique" ON "_ProfessionalCategories"("A", "B");
CREATE INDEX "_ProfessionalCategories_B_index" ON "_ProfessionalCategories"("B");

CREATE UNIQUE INDEX "_CompanyCategories_AB_unique" ON "_CompanyCategories"("A", "B");
CREATE INDEX "_CompanyCategories_B_index" ON "_CompanyCategories"("B");

CREATE UNIQUE INDEX "_ProfessionalLanguages_AB_unique" ON "_ProfessionalLanguages"("A", "B");
CREATE INDEX "_ProfessionalLanguages_B_index" ON "_ProfessionalLanguages"("B");

-- ============================================================================
-- AddForeignKey
-- ============================================================================
ALTER TABLE "users" ADD CONSTRAINT "users_preferredLanguageId_fkey" FOREIGN KEY ("preferredLanguageId") REFERENCES "languages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_defaultAddressId_fkey" FOREIGN KEY ("defaultAddressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_members" ADD CONSTRAINT "company_members_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "request_photos" ADD CONSTRAINT "request_photos_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_revieweeProfessionalProfileId_fkey" FOREIGN KEY ("revieweeProfessionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_revieweeCompanyProfileId_fkey" FOREIGN KEY ("revieweeCompanyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commissions" ADD CONSTRAINT "commissions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "disputes" ADD CONSTRAINT "disputes_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_respondentProfessionalProfileId_fkey" FOREIGN KEY ("respondentProfessionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_respondentCompanyProfileId_fkey" FOREIGN KEY ("respondentCompanyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "_ProfessionalCategories" ADD CONSTRAINT "_ProfessionalCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProfessionalCategories" ADD CONSTRAINT "_ProfessionalCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_CompanyCategories" ADD CONSTRAINT "_CompanyCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "company_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_CompanyCategories" ADD CONSTRAINT "_CompanyCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ProfessionalLanguages" ADD CONSTRAINT "_ProfessionalLanguages_A_fkey" FOREIGN KEY ("A") REFERENCES "languages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProfessionalLanguages" ADD CONSTRAINT "_ProfessionalLanguages_B_fkey" FOREIGN KEY ("B") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- CHECK constraints — cannot be expressed in Prisma's schema language
-- ============================================================================

-- Exactly one of professionalProfileId / companyProfileId set (the
-- solo-pro-vs-company duality used throughout the schema).
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_provider_xor_check"
  CHECK (num_nonnulls("professionalProfileId", "companyProfileId") = 1);

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewee_xor_check"
  CHECK (num_nonnulls("revieweeProfessionalProfileId", "revieweeCompanyProfileId") = 1);

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recipient_xor_check"
  CHECK (num_nonnulls("professionalProfileId", "companyProfileId") = 1);

ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_owner_xor_check"
  CHECK (num_nonnulls("professionalProfileId", "companyProfileId") = 1);

ALTER TABLE "disputes" ADD CONSTRAINT "disputes_respondent_xor_check"
  CHECK (num_nonnulls("respondentProfessionalProfileId", "respondentCompanyProfileId") = 1);

-- Commission also references professionalProfileId/companyProfileId, but
-- unlike the others it's allowed to be a platform-only adjustment with
-- neither set in edge cases (e.g. a manual correction) — so it intentionally
-- gets an "at most one" check rather than "exactly one".
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_recipient_at_most_one_check"
  CHECK (num_nonnulls("professionalProfileId", "companyProfileId") <= 1);

-- Review rating bounds.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range_check"
  CHECK ("rating" >= 1 AND "rating" <= 5);

-- Money fields that represent a magnitude (never negative). Transaction.amount
-- is deliberately excluded — it's a signed ledger entry (see schema comment).
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_nonnegative_check" CHECK ("amount" >= 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_nonnegative_check" CHECK ("amount" >= 0);
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_amount_nonnegative_check" CHECK ("amount" >= 0);
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_amount_nonnegative_check" CHECK ("amount" >= 0);
