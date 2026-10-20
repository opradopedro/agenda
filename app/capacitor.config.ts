import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.opradopedro.agenda",
  appName: "Agenda",
  webDir: "dist",
  android: {
    // o WebView guarda os dados (IndexedDB) do app
    allowMixedContent: false,
  },
};

export default config;
