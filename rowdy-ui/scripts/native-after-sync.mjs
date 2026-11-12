import { readFileSync, writeFileSync } from 'node:fs';
// Capacitor 8 emits Swift tools 5.9 with .v18, which requires tools 6.0.
// The string form works with 5.9 and preserves our iOS 18 minimum.
const path = new URL('../ios/App/CapApp-SPM/Package.swift', import.meta.url);
writeFileSync(path, readFileSync(path, 'utf8').replace('.iOS(.v18)', '.iOS("18.0")'));
