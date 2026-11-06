// Stylesheets are side-effect imports: Vite turns them into <style> tags, TypeScript only
// needs to accept that the specifier resolves. This used to come from `types: ["vite/client"]`
// in the webview-only tsconfig, which also pulled Vite's ambient globals into the extension
// host; TypeScript 7 turns the missing declaration into an error (TS2882) instead of a shrug.
declare module '*.css'
declare module '*.less'


