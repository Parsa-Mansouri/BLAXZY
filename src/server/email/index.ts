export {
  ConsoleEmailSender,
  SmtpEmailSender,
  getEmailSender,
  type EmailMessage,
  type EmailSender,
} from "./sender";
export { passwordResetEmail, verificationCodeEmail } from "./templates";
