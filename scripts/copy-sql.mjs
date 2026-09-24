import {cp, mkdir} from 'node:fs/promises';
const root = new URL('../server/', import.meta.url);
await mkdir(new URL('dist/db/', root), {recursive: true});
await cp(new URL('src/db/schema.sql', root), new URL('dist/db/schema.sql', root));
await cp(new URL('src/db/migrations', root), new URL('dist/db/migrations', root), {recursive: true});
