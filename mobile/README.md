# PetBill Shield Mobile

Expo/React Native starter for the PetBill Shield iOS, Android, iPad, and tablet app.

## Run locally

```bash
cd mobile
cp env.sample .env
npm install
npm start
```

Set `EXPO_PUBLIC_API_URL` to the backend API root. Production defaults to:

```bash
EXPO_PUBLIC_API_URL=https://api.petbillshield.com/api
```

## Build an installable iPhone test app

You need an Apple Developer account for a downloadable iPhone build because iOS
requires signed apps on real devices.

```bash
cd mobile
npm install
npm run build:ios:preview
```

The first EAS build will ask you to:

1. Sign in or create an Expo account.
2. Connect or create the EAS project.
3. Sign in with your Apple Developer account.
4. Register your iPhone for internal distribution if prompted.

When the build finishes, Expo gives you a download/install link. Open that link
on your iPhone to install the app and test against the live backend.

For Android testing:

```bash
npm run build:android:preview
```

## Current first pass

- Email/password sign in and sign up
- Secure mobile session token storage
- Dashboard overview
- Pet list and quick pet creation
- Pet records list
- Reminders list
- Bill analysis with typed text or native PDF/image picker
- Tablet-aware side navigation

## Next production steps

- Native Google OAuth credentials for iOS and Android
- Push notification permissions and reminder notifications
- App Store and Play Store subscription billing, or a compliant read-only subscription state for existing web subscribers
- EAS build profiles and app icons/splash assets
