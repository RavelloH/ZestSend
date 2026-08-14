# Contributing to ZestSend

Thanks for contributing.

## Local setup

Use Node.js with the pnpm version declared in `package.json`.

```bash
pnpm install
pnpm dev:worker
```

Copy any required TURN credentials into a local `.env` file. Do not commit
credentials, local build output, or generated type files unless a change
explicitly requires them.

## Before opening a pull request

```bash
pnpm check
pnpm build
```

For connection, media, or transfer changes, verify the feature with two
separate browser sessions. Include the tested scenarios and any limitations in
the pull request description.

## Pull requests

- Keep changes focused and describe user-visible behavior.
- Preserve the Chinese and English interfaces when changing copy.
- Prefer accessible controls with descriptive labels.
- Do not commit `.env` files, access tokens, or recorded user media.
