// The one place that knows whether this build is the phone app. Every difference between the app and the website
// imports `isNative` from here, so the seams stay easy to find and the web bundle's behaviour stays obvious.
//
// Today that is the build flag alone: the app's bundle is built with VITE_NATIVE=1 (Vite replaces it at build time,
// so the web bundle drops the native branches and the app's bundle drops the web-only ones). When the Capacitor shell
// is added, Capacitor.isNativePlatform() joins the flag here; @capacitor/core is not installed yet, so nothing
// imports it.
export const isNative: boolean = !!import.meta.env.VITE_NATIVE;
