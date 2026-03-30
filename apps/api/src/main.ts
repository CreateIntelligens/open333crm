// Compatibility entrypoint.
// Keep `index.ts` as the single runtime bootstrap and delegate here so any
// legacy references to `src/main.ts` do not drift into a second server setup.
import './index.js';
