// Deployment base path and prod flag for the independent (Pipelines) build.
//
// The app is served at the ROOT of its domain (e.g. Vercel), so BASE_PATH is empty by default.
// If you ever host it under a sub-path, set REACT_APP_BASE_PATH (e.g. "/app") at build time.
//
// IS_PROD is a BUILD-TIME value: 'production' only when the bundle is produced with `npm run build`
// (react-scripts forces NODE_ENV=production). A `npm start` dev bundle is 'development'.
export const IS_PROD = process.env.NODE_ENV === 'production';
export const BASE_PATH = process.env.REACT_APP_BASE_PATH || '';
