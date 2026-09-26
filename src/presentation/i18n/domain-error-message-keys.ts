/**
 * Module 120 — Multilingual Localization: exact domain-error message →
 * `errors.domain.<key>` registry. See `error-messages.ts` for the
 * resolution order this participates in.
 *
 * Rules:
 * - Only *static* messages (a string literal at the `throw` site) belong
 *   here. Messages built with interpolation fall back to their code-level
 *   sentence (`errors.byCode.*`).
 * - The key must exist in `src/i18n/messages/es/errors.json` under
 *   `domain` (and, via the completeness test, in every other locale).
 * - `domain-error-message-keys.test.ts` fails if a message listed here no
 *   longer appears verbatim anywhere under `src/core` or `src/app`.
 *
 * Deliberately NOT registered (they fall back to `errors.byCode.*` /
 * the caller's fallback, which is the right text for them):
 * - messages built with interpolation (`NotFoundError(entity, id)`,
 *   provider errors prefixed with `[stripe_connect:…]`, etc.);
 * - developer/programmer invariants that no user input can reach
 *   (entity construction asserts in `domain/entities/*`, tax-engine
 *   argument checks, `ai-visibility` classification asserts,
 *   self-billing grant/revoke id asserts, notification-creation guards,
 *   pagination `offset` guards, `RangeError`s in infrastructure);
 * - `RateLimitedError`'s default message — it must reach the
 *   `rateLimitedRetry` branch of `localizeError` (retry seconds);
 * - `UnauthorizedError`/`AccountRestrictedError` defaults — their
 *   `byCode` sentence is already the exact user-facing equivalent.
 */
export const DOMAIN_ERROR_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  "This account does not use a password.":
    "accountHasNoPassword",
  "You must have an active professional profile to start identity verification.":
    "activeProfileRequiredForIdentityVerification",
  "You must have an active professional profile to manage your portfolio.":
    "activeProfileRequiredForPortfolio",
  "You must have an active professional profile to manage verification documents.":
    "activeProfileRequiredForVerificationDocs",
  "You must have an active professional profile to manage quotes.":
    "activeProfileRequiredToManageQuotes",
  "You must have an active professional profile to request verification.":
    "activeProfileRequiredToRequestVerification",
  "You must have an active professional profile to resubmit a verification request.":
    "activeProfileRequiredToResubmitVerification",
  "You must have an active professional profile to submit quotes.":
    "activeProfileRequiredToSubmitQuotes",
  "You must have an active professional profile to submit a verification request.":
    "activeProfileRequiredToSubmitVerification",
  "You already have an active quote for this service request.":
    "activeQuoteExists",
  "FINANCIAL_ADJUSTMENT_REQUIRED resolutions require an explicit, positive amount.":
    "adjustmentAmountRequired",
  "This financial adjustment is no longer pending.":
    "adjustmentNotPending",
  "FINANCIAL_ADJUSTMENT_REQUIRED resolutions require an explicit adjustment type — this function never guesses one.":
    "adjustmentTypeRequired",
  "An admin cannot restrict their own account.":
    "adminCannotRestrictSelf",
  "You are already a member of this company.":
    "alreadyCompanyMember",
  "You must have a customer profile to view analytics.":
    "analyticsRequiresCustomerProfile",
  "You must have a professional profile to view analytics.":
    "analyticsRequiresProfessionalProfile",
  "This appointment can no longer be cancelled.":
    "appointmentCannotBeCancelled",
  "This appointment can no longer be completed.":
    "appointmentCannotBeCompleted",
  "This appointment can no longer be confirmed.":
    "appointmentCannotBeConfirmed",
  "This appointment can no longer be rescheduled.":
    "appointmentCannotBeRescheduled",
  "This appointment can no longer be proposed for.":
    "appointmentCannotBeScheduled",
  "This appointment can no longer be scheduled.":
    "appointmentCannotBeScheduled",
  "This professional already has a confirmed appointment that overlaps with this time.":
    "appointmentOverlap",
  "At least one role is required.":
    "atLeastOneRole",
  "An automated identity check cannot be started for this verification in its current state.":
    "automatedCheckUnavailable",
  "An active booking restriction on your account blocks accepting quotes right now.":
    "bookingRestrictedCustomer",
  "This professional currently has a booking restriction and cannot accept new bookings.":
    "bookingRestrictedProfessional",
  "Minimum budget must not exceed maximum budget.":
    "budgetMinExceedsMax",
  "Upload at least one business registration document before resubmitting.":
    "businessDocRequiredToResubmit",
  "Upload at least one business registration document before submitting for review.":
    "businessDocRequiredToSubmit",
  "This professional's verification case is missing a business-registration document and cannot be approved yet.":
    "businessRegistrationMissing",
  "You can only delete your own messages.":
    "canOnlyDeleteOwnMessages",
  "A cancellation reason is required.":
    "cancellationReasonRequired",
  "You cannot change your own role.":
    "cannotChangeOwnRole",
  "You cannot execute erasure for another user's account.":
    "cannotEraseOthersAccount",
  "You cannot export another user's personal data.":
    "cannotExportOthersData",
  "You cannot submit a quote for your own service request.":
    "cannotQuoteOwnRequest",
  "Cannot remove the last remaining admin's admin role.":
    "cannotRemoveLastAdmin",
  "Cannot suspend the last remaining admin.":
    "cannotSuspendLastAdmin",
  "Choose which professional to message.":
    "chooseProfessionalToMessage",
  "This payment is not associated with an accepted job — cannot calculate a commission.":
    "commissionNoAcceptedJob",
  "This payment has not been approved for release yet — commission cannot be recognized until the Module 66 payment-release decision is RELEASE_APPROVED.":
    "commissionReleaseNotApproved",
  "A commission can only be recorded once the payment has been captured.":
    "commissionRequiresCapturedPayment",
  "This company has no active self-billing authorization to revoke.":
    "companyNoSelfBillingToRevoke",
  "Only a company owner or admin may cancel invitations.":
    "companyOwnerAdminCancelInvitations",
  "Only a company owner or admin may edit the company profile.":
    "companyOwnerAdminEditProfile",
  "Only a company owner or admin may edit the company's services.":
    "companyOwnerAdminEditServices",
  "Only a company owner or admin may grant self-billing authorization on behalf of the company.":
    "companyOwnerAdminGrantSelfBilling",
  "Only a company owner or admin may invite members.":
    "companyOwnerAdminInvite",
  "Only a company owner or admin may manage the company's portfolio.":
    "companyOwnerAdminManagePortfolio",
  "Only a company owner or admin may manage verification documents.":
    "companyOwnerAdminManageVerificationDocs",
  "Only a company owner or admin may request verification.":
    "companyOwnerAdminRequestVerification",
  "Only a company owner or admin may resubmit a verification request.":
    "companyOwnerAdminResubmitVerification",
  "Only a company owner or admin may revoke self-billing authorization on behalf of the company.":
    "companyOwnerAdminRevokeSelfBilling",
  "Only a company owner or admin may submit a verification request.":
    "companyOwnerAdminSubmitVerification",
  "Only a company owner or admin may view invitations.":
    "companyOwnerAdminViewInvitations",
  "Only a company owner or admin may view the company's self-billing authorization status.":
    "companyOwnerAdminViewSelfBilling",
  "Only a company owner or admin may view verification details.":
    "companyOwnerAdminViewVerification",
  "Only a company owner or admin may view verification documents.":
    "companyOwnerAdminViewVerificationDocs",
  "A company with this tax ID already exists.":
    "companyTaxIdExists",
  "This company already has an active verification request.":
    "companyVerificationActive",
  "Complete your professional profile before activating your account.":
    "completeProfileBeforeActivating",
  "Complete your professional profile before starting onboarding.":
    "completeProfileBeforeOnboarding",
  "Complete your professional profile before checking onboarding status.":
    "completeProfileBeforeOnboardingStatus",
  "This job completion confirmation has already been resolved.":
    "completionAlreadyResolved",
  "This job's completion confirmation has already been resolved.":
    "completionAlreadyResolved",
  "This job's completion confirmation was just resolved by another request.":
    "completionJustResolved",
  "This job already has a completion confirmation record.":
    "completionRecordExists",
  "This consent has already been withdrawn.":
    "consentAlreadyWithdrawn",
  "This conversation is no longer open for new messages.":
    "conversationClosed",
  "The requested credit note amount must be greater than zero.":
    "creditNoteAmountPositive",
  "This invoice belongs to a different professional/company — a credit note cannot be created against it.":
    "creditNoteInvoiceMismatch",
  "A credit note requires a non-empty reason.":
    "creditNoteReasonRequired",
  "This job's original invoice total is zero — no credit note can be derived from it.":
    "creditNoteZeroInvoice",
  "Current password is incorrect.":
    "currentPasswordIncorrect",
  "A time-series query requires both a start and end date.":
    "dateRangeRequired",
  "This dispute is closed and no longer accepts new evidence.":
    "disputeClosedNoEvidence",
  "This dispute is closed and no longer accepts new messages.":
    "disputeClosedNoMessages",
  "This dispute's resolution requires a financial adjustment that has not been fully applied yet — resolve its financial outcome (ResolveDisputeWithFinancialOutcomeUseCase) before closing.":
    "disputeFinancialAdjustmentPending",
  "Cannot resolve in the customer's favor with a financial outcome: no captured payment exists for this job to refund.":
    "disputeNoPaymentToRefund",
  "A dispute can only be opened once work has started (in progress, completed, or cancelled).":
    "disputeRequiresStartedWork",
  "This dispute is RESOLVED but has no recorded resolution — cannot proceed.":
    "disputeResolutionMissing",
  "This dispute's status changed before this update could be applied.":
    "disputeStatusChanged",
  "Use the resolve/reject/close action for this transition — it requires a resolution note.":
    "disputeTransitionNeedsResolutionNote",
  "The window to open a dispute for this job has passed.":
    "disputeWindowPassed",
  "This job is marked disputed but has no linked dispute — cannot approve release.":
    "disputedJobWithoutDispute",
  "You do not have permission to view this document.":
    "documentAccessDenied",
  "Documents can only be added before submission or when a resubmission is requested.":
    "documentsAddLocked",
  "Documents can only be removed before submission or when a resubmission is requested.":
    "documentsRemoveLocked",
  "You must have a professional profile to view earnings.":
    "earningsRequireProfessionalProfile",
  "An account with this email already exists.":
    "emailAlreadyRegistered",
  "File URL must be an http(s) link.":
    "fileUrlMustBeHttp",
  "An IBAN is required for the IBAN payout method.":
    "ibanRequired",
  "An IBAN is required to register an IBAN payout destination.":
    "ibanRequired",
  "Upload at least one identity document before resubmitting for review.":
    "identityDocRequiredToResubmit",
  "Upload at least one identity document before submitting for review.":
    "identityDocRequiredToSubmit",
  "Incorrect password.":
    "incorrectPassword",
  "Enter a valid appointment window (30 minutes to 12 hours long).":
    "invalidAppointmentWindow",
  "Invalid end date.":
    "invalidEndDate",
  "Enter a valid IBAN.":
    "invalidIban",
  "Invalid role for an invitation.":
    "invalidInvitationRole",
  "One or more selected service categories are invalid.":
    "invalidServiceCategories",
  "Invalid start date.":
    "invalidStartDate",
  "This invitation can no longer be cancelled.":
    "invitationCannotBeCancelled",
  "This invitation is no longer valid.":
    "invitationNoLongerValid",
  "This invitation was not addressed to your account.":
    "invitationNotForYou",
  "There is already a pending invitation for this email address.":
    "invitationPendingForEmail",
  "This job has neither a professional nor a company assigned — cannot draft an invoice.":
    "invoiceNoAssignee",
  "An invoice can only be drafted once the customer's payment has been captured.":
    "invoiceRequiresCapturedPayment",
  "An invoice can only be drafted once the job is COMPLETED.":
    "invoiceRequiresCompletedJob",
  "This invoice's self-billing authorization is no longer active — it must be re-granted before the invoice can be accepted.":
    "invoiceSelfBillingInactive",
  "MaestroYa's issuer tax ID is still the unconfirmed placeholder value — a real invoice cannot be issued until the platform's registered CIF/NIF is configured.":
    "issuerTaxIdNotConfigured",
  "This job has already been paid.":
    "jobAlreadyPaid",
  "This job has been cancelled and can no longer be paid.":
    "jobCancelledCannotPay",
  "This job can no longer be cancelled.":
    "jobCannotBeCancelled",
  "This job can no longer be completed.":
    "jobCannotBeCompleted",
  "This job can no longer be started.":
    "jobCannotBeStarted",
  "This job still has an unresolved appointment — resolve or cancel every appointment before completing the job.":
    "jobHasUnresolvedAppointment",
  "This job must be completed before it can be reviewed.":
    "jobMustBeCompletedToReview",
  "This job must be started before it can be completed.":
    "jobMustBeStartedToComplete",
  "This job has not been marked completed by the professional yet.":
    "jobNotMarkedCompleted",
  "The linked dispute must be closed before payment release can be approved.":
    "linkedDisputeMustBeClosed",
  "The linked manual review case must be resolved before payment release can be approved.":
    "linkedReviewCaseMustBeResolved",
  "Every material needs a name and a quantity greater than zero.":
    "materialNameAndQuantity",
  "A materials list is required when the customer purchases the materials.":
    "materialsListRequired",
  "Materials must be purchased and confirmed before the scheduled work can begin.":
    "materialsNotConfirmed",
  "Media URL must be a valid http(s) URL.":
    "mediaUrlInvalid",
  "Write a message before sending.":
    "messageEmpty",
  "An active messaging restriction on your account blocks sending messages right now.":
    "messagingRestricted",
  "Your account must have a name set before starting identity verification.":
    "nameRequiredForIdentityVerification",
  "This job has no completion confirmation record.":
    "noCompletionConfirmation",
  "You do not have permission to do that.":
    "noPermission",
  "You do not have permission to assign that role.":
    "noPermissionAssignRole",
  "You do not have permission to remove this member.":
    "noPermissionRemoveMember",
  "No proposed time to confirm.":
    "noProposedTimeToConfirm",
  "There is no proposed time to confirm.":
    "noProposedTimeToConfirm",
  "You have no active self-billing authorization to revoke.":
    "noSelfBillingToRevoke",
  "You are not eligible to submit a quote for this service request.":
    "notEligibleToQuote",
  "Online payments are temporarily unavailable. Please try again later.":
    "onlinePaymentsUnavailable",
  "Only an accepted quote can be paid.":
    "onlyAcceptedQuoteCanBePaid",
  "Only a confirmed appointment can be marked completed.":
    "onlyConfirmedAppointmentCanBeCompleted",
  "Only the customer can review this job.":
    "onlyCustomerCanReview",
  "Only the customer can confirm this job's completion.":
    "onlyCustomerConfirmsCompletion",
  "Only the customer can dispute this job's completion.":
    "onlyCustomerDisputesCompletion",
  "Only the professional/company this invoice was issued to may accept it.":
    "onlyInvoiceRecipientAccepts",
  "Only open requests can be cancelled.":
    "onlyOpenRequestsCancellable",
  "Only open requests can be edited.":
    "onlyOpenRequestsEditable",
  "Only the current company owner may transfer ownership.":
    "onlyOwnerTransfersOwnership",
  "Only a pending verification request can be moved to review.":
    "onlyPendingToReview",
  "Only the professional can mark this job completed.":
    "onlyProfessionalCompletesJob",
  "Only the professional can start this job.":
    "onlyProfessionalStartsJob",
  "Only a SUPER_ADMIN may grant ADMIN or SUPER_ADMIN privileges.":
    "onlySuperAdminGrantsAdmin",
  "You already have an open dispute for this job.":
    "openDisputeExists",
  "You already have an open dispute for this job, or the case number collided — please retry.":
    "openDisputeExistsOrRetry",
  "The other party needs to confirm this proposed time.":
    "otherPartyMustConfirm",
  "The company owner cannot leave without transferring ownership first.":
    "ownerMustTransferBeforeLeaving",
  "Ownership can only be transferred to another active member of this company.":
    "ownershipTargetMustBeMember",
  "A partial resolution requires an explicit, positive refund amount.":
    "partialRefundAmountRequired",
  "A partial resolution's refund amount must be less than the full captured payment amount — use CUSTOMER_FAVOR for a full refund.":
    "partialRefundTooHigh",
  "Cannot record a partial resolution's financial outcome: no captured payment exists for this job.":
    "partialResolutionNoPayment",
  "Enter your password to confirm.":
    "passwordRequiredToConfirm",
  "A payment for this job is already being processed. Please try again in a moment.":
    "paymentInProgress",
  "This job has an open dispute — payout execution is blocked until it is closed.":
    "payoutBlockedByDispute",
  "You must have a professional profile to add a payout destination.":
    "payoutDestinationRequiresProfile",
  "This job was cancelled — no payout can be executed.":
    "payoutJobCancelled",
  "This job has neither a professional nor a company assigned — cannot execute a payout.":
    "payoutNoAssignee",
  "This payout destination has no Stripe Connect account yet — cannot execute a transfer.":
    "payoutNoStripeAccount",
  "An active payout hold blocks this payout from being executed.":
    "payoutOnHold",
  "This job's payment release has not reached RELEASE_APPROVED — a payout can only be executed once Module 66's release decision approves it.":
    "payoutReleaseNotApproved",
  "Photos can only be added while a request is open.":
    "photosAddOnlyOpen",
  "Photos can only be removed while a request is open.":
    "photosRemoveOnlyOpen",
  "Description must be 2000 characters or fewer.":
    "portfolioDescriptionLength",
  "Title must be between 3 and 120 characters.":
    "portfolioTitleLength",
  "You are not authorized to view this user's presence.":
    "presenceNotAuthorized",
  "A priced materials item is not allowed when the customer purchases the materials directly.":
    "pricedMaterialsNotAllowed",
  "This professional profile is already deactivated.":
    "professionalAlreadyDeactivated",
  "Your professional profile must be verified before you can do this.":
    "professionalNotVerified",
  "A professional profile already exists for this account.":
    "professionalProfileExists",
  "Proposed times must be at least 2 hours from now.":
    "proposedTimeTooSoon",
  "This quote can no longer be accepted.":
    "quoteCannotBeAccepted",
  "This quote can no longer be edited.":
    "quoteCannotBeEdited",
  "This quote can no longer be withdrawn.":
    "quoteCannotBeWithdrawn",
  "This quote has no payable amount.":
    "quoteNoPayableAmount",
  "Rating must be a whole number from 1 to 5.":
    "ratingRange",
  "A customer receipt can only be drafted once the customer's payment has been captured.":
    "receiptRequiresCapturedPayment",
  "A customer receipt can only be drafted once the job is COMPLETED.":
    "receiptRequiresCompletedJob",
  "This referral link does not belong to your partner account.":
    "referralLinkNotYours",
  "A refund-type adjustment cannot exceed the full captured payment amount.":
    "refundAdjustmentTooHigh",
  "A rejection reason of 10–1000 characters is required.":
    "rejectionReasonLength",
  "A rejection reason is required.":
    "rejectionReasonRequired",
  "This job's payment release decision changed before this update could be applied.":
    "releaseDecisionChanged",
  "Admin release resolution only applies to jobs that are disputed or under manual review for a confirmation timeout — every other job is handled by the normal automatic release evaluation.":
    "releaseResolutionNotApplicable",
  "This request can no longer accept a quote.":
    "requestCannotAcceptQuote",
  "This reset link is invalid or has expired.":
    "resetLinkInvalid",
  "This resolution decision has already been applied.":
    "resolutionDecisionApplied",
  "A resolution decision already exists for this dispute.":
    "resolutionDecisionExists",
  "A response cannot be empty.":
    "responseEmpty",
  "A resubmission can only be requested for a pending or in-review request.":
    "resubmissionOnlyPendingOrInReview",
  "A resubmission reason of 10–1000 characters is required.":
    "resubmissionReasonLength",
  "A resubmission reason is required.":
    "resubmissionReasonRequired",
  "This review can no longer be edited — the edit window has passed.":
    "reviewEditWindowPassed",
  "A review already exists for this job.":
    "reviewExists",
  "This job is under manual review but has no linked review case — cannot approve release.":
    "reviewJobWithoutCase",
  "Select a valid, active service category.":
    "selectActiveServiceCategory",
  "Select Stripe Express as your payout method before connecting a Stripe account.":
    "selectStripeExpressBeforeConnecting",
  "Select Stripe Express as your payout method first.":
    "selectStripeExpressFirst",
  "This professional has not authorized MaestroYa's self-billing process.":
    "selfBillingNotAuthorized",
  "Selected service category is invalid.":
    "serviceCategoryInvalid",
  "Selected service category is invalid or inactive.":
    "serviceCategoryInvalidOrInactive",
  "You must be signed in to do that.":
    "signInRequired",
  "The start date must be before the end date.":
    "startDateAfterEnd",
  "Start onboarding before activating your account.":
    "startOnboardingBeforeActivating",
  "This Stripe Connect account cannot currently receive transfers.":
    "stripeAccountCannotReceiveTransfers",
  "Create a Stripe connected account before opening the Stripe dashboard.":
    "stripeAccountRequiredForDashboard",
  "Create a Stripe connected account before requesting an onboarding link.":
    "stripeAccountRequiredForOnboarding",
  "You must have a professional profile to connect a Stripe account.":
    "stripeConnectRequiresProfile",
  "You must have a professional profile to open the Stripe dashboard.":
    "stripeDashboardRequiresProfile",
  "You must have a professional profile to check Stripe account status.":
    "stripeStatusRequiresProfile",
  "Ticket number collided — please retry.":
    "ticketNumberCollision",
  "This ticket's status changed before this update could be applied.":
    "ticketStatusChanged",
  "Use the resolve/close action for this transition — it requires a resolution note.":
    "ticketTransitionNeedsResolutionNote",
  "This user is already a member of the company.":
    "userAlreadyMember",
  "This verification request cannot be approved in its current state.":
    "verificationCannotBeApproved",
  "This verification request cannot be rejected in its current state.":
    "verificationCannotBeRejected",
  "This verification request cannot be resubmitted in its current state.":
    "verificationCannotBeResubmitted",
  "This verification request cannot be reviewed in its current state.":
    "verificationCannotBeReviewed",
  "This verification request cannot be submitted in its current state.":
    "verificationCannotBeSubmitted",
  "This verification request cannot request a resubmission in its current state.":
    "verificationCannotRequestResubmission",
  "This verification link is invalid or has expired.":
    "verificationLinkInvalid",
  "You already have an active verification request.":
    "verificationRequestActive",
  "Your professional profile must be verified before you can submit quotes.":
    "verificationRequiredToSubmitQuotes",
};
