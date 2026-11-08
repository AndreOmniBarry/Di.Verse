// Shows what your API.Bible key unlocks and the raw response for John 3:16.
// Usage: put APIBIBLE_KEY in .env, then `npm run check:apibible`
//        optional: npm run check:apibible -- NKJV   (fetch that translation)
require('dotenv').config({ quiet: true });
const apiBible = require('../services/apiBible');

(async () => {
  if (!process.env.APIBIBLE_KEY) {
    console.log('APIBIBLE_KEY is not set in .env. Get a key at https://api.bible (sign in, create an app).');
    process.exit(1);
  }
  try {
    const { data } = await apiBible.request('/bibles?language=eng');
    console.log(`\n${data.length} English Bibles on this key:\n`);
    for (const b of data) console.log(`  ${String(b.abbreviationLocal || b.abbreviation).padEnd(10)} ${b.id}  ${b.name}`);
  } catch (err) {
    console.log('Listing Bibles failed:', err.message);
    process.exit(1);
  }

  const code = (process.argv[2] || 'NKJV').toUpperCase();
  console.log(`\nFetching John 3:16 in ${code} through Di.Verse:`);
  const verse = await apiBible.getVerse(43, 'John', 3, 16, code);
  console.log(verse);
  if (verse.error) {
    console.log(`\nIf ${code} is in the list above under a different abbreviation, pin it in .env:`);
    console.log(`  APIBIBLE_IDS=${code}=<id from the list>`);
  }
})();
