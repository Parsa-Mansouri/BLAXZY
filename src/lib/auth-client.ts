"use client";

import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client for client components. Calls the same-origin `/api/auth/*` endpoints.
 *
 * - sign up:            authClient.signUp.email({ name, email, password, callbackURL })
 * - sign in:            authClient.signIn.email({ email, password, callbackURL })
 * - sign out:           authClient.signOut()
 * - resend verification: authClient.sendVerificationEmail({ email, callbackURL })
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
  ],
});
