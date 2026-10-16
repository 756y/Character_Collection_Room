// Backwards-compatible adapter: all character cloud operations now use Google Drive/Sheets.
export { listCharacters, syncCharacters, migrateLocalCharacters, signInWithGoogle, signOutGoogle } from './googleDrive'
