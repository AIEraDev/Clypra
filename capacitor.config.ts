import type { CapacitorConfig } from "@capacitor/cli";
import os from "os";

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const isLiveReload = process.env.CAPACITOR_LIVE_RELOAD === "true";
const localIP = getLocalIP();

const config: CapacitorConfig = {
  appId: "com.vireostudio.app",
  appName: "VireoStudio",
  webDir: "dist",
  server: isLiveReload
    ? {
        androidScheme: "https",
        url: `http://${localIP}:1420`,
        cleartext: true,
      }
    : undefined,
};

export default config;
