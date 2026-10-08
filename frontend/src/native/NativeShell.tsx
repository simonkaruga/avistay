/**
 * App-only behaviour (iOS/Android). Renders nothing; on the website it isn't loaded.
 *
 * - Android back button: go back in the app, exit from the home screen
 * - Deep links: https://naivastay.com/property/123 opens that page in the app
 * - Status bar + splash screen styling
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { platform } from "./platform";

const ROOT_PATHS = new Set(["/", "/owner", "/admin", "/agent"]);
const APP_HOSTS = new Set(["naivastay.com", "www.naivastay.com"]);

export default function NativeShell() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    SplashScreen.hide().catch(() => {});
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    if (platform === "android") StatusBar.setBackgroundColor({ color: "#1f4d36" }).catch(() => {});
  }, []);

  useEffect(() => {
    const back = App.addListener("backButton", ({ canGoBack }) => {
      if (!canGoBack || ROOT_PATHS.has(window.location.pathname)) App.exitApp();
      else window.history.back();
    });
    const links = App.addListener("appUrlOpen", ({ url }) => {
      try {
        const u = new URL(url);
        if (APP_HOSTS.has(u.hostname)) navigate(`${u.pathname}${u.search}`);
      } catch { /* ignore malformed links */ }
    });
    return () => { back.then(h => h.remove()); links.then(h => h.remove()); };
  }, [navigate]);

  // Scroll to top on navigation — native users expect it, and there's no browser restore.
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return null;
}
