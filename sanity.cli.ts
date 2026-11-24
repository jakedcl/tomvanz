import {defineCliConfig} from 'sanity/cli'
import {dataset, projectId} from './src/lib/sanity/env'

export default defineCliConfig({
  api: {
    projectId,
    dataset,
  },
  typegen: {
    path: './src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    schema: './schema.json',
    generates: './src/lib/sanity/sanity.types.ts',
  },
})
