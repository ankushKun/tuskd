# TuskTable

Walrus-native Airtable-style forms for the Walrus + Sui Sessions hackathon.

This project is configured for **Sui Testnet** and **Walrus Testnet** for now.

## What it does

- Build structured feedback forms with required fields, ratings, dropdowns, checkboxes, URLs, rich text, screenshots, and video uploads.
- Manage draft and published forms from a creator dashboard.
- Publish shareable form links.
- Store schemas, submissions, and media through Walrus Testnet.
- Review, filter, prioritize, and export submissions from an admin dashboard.
- Show Walrus receipts and real Sui Testnet transaction digests from the Move package calls.
- Include a minimal Sui Move package in `move/` for the form object and submission/status events.

## Run locally

```bash
npm install
npm run dev
```

Testnet env:

```bash
cp .env.example .env.local
VITE_SUI_RPC_URL=https://fullnode.testnet.sui.io:443
VITE_WALRUS_PUBLISHER=https://publisher.walrus-testnet.walrus.space
VITE_WALRUS_AGGREGATOR=https://aggregator.walrus-testnet.walrus.space
VITE_WALRUS_EPOCHS=5
```

Walrus and Sui Testnet calls are required. Upload or transaction failures stop the publish/submit flow instead of falling back to browser-only storage.

## Local Flow

1. Open `/forms`.
2. Create a draft from the forms dashboard.
3. Edit fields in `/builder/:formId`.
4. Publish and copy the share link.
5. Submit real feedback with a screenshot or video.
6. Open `/admin/:formId`, filter/prioritize responses, and export CSV.

## Sui package

The Move package in `move/` defines the intended on-chain contract:

- `create_form(title, description, schema_blob_id)`
- `submit(form, submission_blob_id, media_blob_ids)`
- `set_submission_status(form, submission_id, status, priority)`

Publish, submit, and response status changes are wallet-signed Sui Testnet transactions. Deploy the package in `move/`, then set `VITE_TUSKTABLE_PACKAGE_ID` to the published package ID.
