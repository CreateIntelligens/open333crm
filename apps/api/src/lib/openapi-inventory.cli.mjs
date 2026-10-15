import { generateOpenApi } from './openapi-inventory.mjs';

generateOpenApi().then((document) => {
  console.log(`Generated ${Object.values(document.paths).reduce((count, item) => count + Object.keys(item).length, 0)} OpenAPI operations.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
