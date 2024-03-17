# @thegrumpysnail/adapter-lambda

Based off of the [Node Server Adapter](https://kit.svelte.dev/docs/adapter-node) and designed to be used with [serverless](https://www.npmjs.com/package/serverless). Some inspiration was also taken from [svelte-adapter-lambda](https://github.com/tessellator/sveltekit-adapter-lambda).

## Installation

```bash
npm install --save @thegrumpysnail/adapter-lambda

npm install --save express serverless-http
npm install --save-dev serverless
```

## Usage

Set up your `svelte.config.js` to use the lambda adapter.

```js
// svelte.config.js

import adapter from '@thegrumpysnail/adapter-lambda';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
  },
};

export default config;
```

Create a handler that will wrap the generated handler with a new express app, and pass that to serverless to generate the lambda handler.

```js
// handler.js

import express from 'express';
import serverless from 'serverless-http';
import { handler as svelteHandler } from './build/handler.js';

const app = express();

app.use(svelteHandler);

export const handler = serverless(app, {
  binary: [ 'image/*' ],
});
```

Set up your `serverless.yml`.

```yaml
# serverless.yml

# ... other configurations ...

functions:
  app:
    handler: handler.handler
```

Update your `package.json`.

```json
{
  "scripts": {
    "deploy": "serverless deploy"
  }
}
```

## License

[MIT](LICENSE)
