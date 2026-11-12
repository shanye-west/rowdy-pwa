import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.rowdycup.app.prototype', appName: 'Rowdy Test', webDir: 'dist-native',
  ios: { scheme: 'App', contentInset: 'never' },
};
export default config;
