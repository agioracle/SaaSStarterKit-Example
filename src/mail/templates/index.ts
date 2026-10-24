/** Compatibility exports only; canonical templates are the individual TSX files.
 * Keep this barrel as .ts so React Email does not mistake it for a preview.
 */
export { EmailLayout } from "../components/email-layout";
export { ActionEmail } from "../components/action-email";
export { default as ForgotPasswordEmail } from "./forgot-password";
export { default as VerifyEmail } from "./verify-email";
export { default as DeleteAccountEmail } from "./delete-account";
export { default as SubscribeNewsletterEmail } from "./subscribe-newsletter";
export { default as ContactMessageEmail } from "./contact-message";
