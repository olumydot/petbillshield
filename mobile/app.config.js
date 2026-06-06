module.exports = {
  expo: {
    name: "PetBill Shield",
    slug: "petbillshield-mobile",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "petbillshield",
    userInterfaceStyle: "dark",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.petbillshield.mobile",
    },
    android: {
      package: "com.petbillshield.mobile",
      adaptiveIcon: {
        backgroundColor: "#16150F",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: ["expo-secure-store"],
  },
};
