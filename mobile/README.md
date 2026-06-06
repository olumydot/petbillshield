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
