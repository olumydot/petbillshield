// Helper to start Emergent Google OAuth
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
// export function startGoogleLogin() {
//   const redirectUrl = window.location.origin + "/dashboard";
//   window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
// }

export const startGoogleLogin = () => {
  console.warn("Google login disabled in local dev. Use Dev Login.");
};
