"use client";

import { emailOTPClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client for client components. Calls the same-origin `/api/auth/*` endpoints.
 * Email verification is a six-digit code (sign-up and an unverified sign-in send one).
 *
 * - sign up:            authClient.signUp.email({ name, email, password, callbackURL })
 * - sign in:            authClient.signIn.email({ email, password, callbackURL })
 * - sign out:           authClient.signOut()
 * - send a code:        authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" })
 * - verify (signs in):  authClient.emailOtp.verifyEmail({ email, otp })
 * - forgot password:    authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })
 * - reset password:     authClient.resetPassword({ newPassword, token })
 * - change password:    authClient.changePassword({ currentPassword, newPassword })
 * - current session:    authClient.useSession()
 */
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: ["user", "admin"], required: false, input: false },
      },
    }),
    emailOTPClient(),
  ],
});
