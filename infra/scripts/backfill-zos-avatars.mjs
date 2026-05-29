#!/usr/bin/env node

/**
 * One-time backfill script: pull zOS/Matrix profile pictures into AURA.
 *
 * For each aura-network user that has no avatar (or a stale mxc:// / _matrix URL),
 * this script:
 *   1. Queries the Matrix homeserver for the user's avatar_url (mxc://)
 *   2. Downloads the image via the authenticated Matrix client API
 *   3. Uploads to AURA's S3 via the presign flow
 *   4. Updates aura-network (users + profiles tables) with the S3 URL
 *
 * Requirements (passed as env vars):
 *   MATRIX_ADMIN_TOKEN        — Synapse admin access token
 *   MATRIX_HOMESERVER_URL     — e.g. https://zos-home-2-e24b9412096f.herokuapp.com
 *   MATRIX_SERVER_NAME        — e.g. zos-home-2.zero.tech
 *   AURA_NETWORK_DB_URL       — Postgres connection string for aura-network
 *   AURA_ROUTER_URL           — e.g. https://aura-router.onrender.com
 *   AURA_USER_JWT             — A valid AURA user JWT (for presign auth)
 *
 * Usage:
 *   DRY_RUN=1 node infra/scripts/backfill-zos-avatars.mjs   # preview only
 *   node infra/scripts/backfill-zos-avatars.mjs              # execute
 */

import pg from "pg";

const MATRIX_ADMIN_TOKEN = process.env.MATRIX_ADMIN_TOKEN;
const MATRIX_HOMESERVER_URL = (process.env.MATRIX_HOMESERVER_URL || "").replace(/\/$/, "");
const MATRIX_SERVER_NAME = process.env.MATRIX_SERVER_NAME || "zos-home-2.zero.tech";
const AURA_NETWORK_DB_URL = process.env.AURA_NETWORK_DB_URL;
const AURA_ROUTER_URL = (process.env.AURA_ROUTER_URL || "https://aura-router.onrender.com").replace(/\/$/, "");
const AURA_USER_JWT = process.env.AURA_USER_JWT;
const DRY_RUN = process.env.DRY_RUN === "1";

if (!MATRIX_ADMIN_TOKEN || !MATRIX_HOMESERVER_URL || !AURA_NETWORK_DB_URL || !AURA_USER_JWT) {
  console.error("Missing required env vars: MATRIX_ADMIN_TOKEN, MATRIX_HOMESERVER_URL, AURA_NETWORK_DB_URL, AURA_USER_JWT");
  process.exit(1);
}

console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
console.log(`Matrix homeserver: ${MATRIX_HOMESERVER_URL}`);
console.log(`Matrix server name: ${MATRIX_SERVER_NAME}`);
console.log(`AURA router: ${AURA_ROUTER_URL}`);
console.log();

const pool = new pg.Pool({ connectionString: AURA_NETWORK_DB_URL, ssl: { rejectUnauthorized: false } });

let _firstRequest = true;
async function getMatrixAvatarUrl(zeroUserId) {
  const matrixId = `@${zeroUserId}:${MATRIX_SERVER_NAME}`;
  const url = `${MATRIX_HOMESERVER_URL}/_matrix/client/v3/profile/${encodeURIComponent(matrixId)}/avatar_url`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${MATRIX_ADMIN_TOKEN}` },
  });

  if (_firstRequest) {
    _firstRequest = false;
    if (resp.status === 401 || resp.status === 403) {
      const body = await resp.text();
      console.error(`\n*** FATAL: Matrix admin token rejected (${resp.status}): ${body} ***`);
      console.error("Check that MATRIX_ADMIN_TOKEN is valid for this homeserver.\n");
      process.exit(1);
    }
    console.log(`Matrix auth OK (first lookup returned ${resp.status})\n`);
  }

  if (!resp.ok) return null;
  const body = await resp.json();
  return body.avatar_url || null; // mxc:// URL or null
}

function parseMxc(mxcUrl) {
  if (!mxcUrl || !mxcUrl.startsWith("mxc://")) return null;
  const rest = mxcUrl.slice(6); // remove "mxc://"
  const slashIdx = rest.indexOf("/");
  if (slashIdx < 0) return null;
  return { server: rest.slice(0, slashIdx), mediaId: rest.slice(slashIdx + 1) };
}

async function downloadMatrixMedia(server, mediaId) {
  const url = `${MATRIX_HOMESERVER_URL}/_matrix/client/v1/media/download/${server}/${mediaId}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${MATRIX_ADMIN_TOKEN}` },
  });
  if (!resp.ok) {
    console.warn(`  download failed: ${resp.status}`);
    return null;
  }
  const contentType = resp.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { buffer, contentType };
}

function extForContentType(ct) {
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  return "png";
}

async function uploadToS3(imageBuffer, contentType, mediaId) {
  // 1. Get presigned URL from aura-router
  const ext = extForContentType(contentType);
  const presignResp = await fetch(`${AURA_ROUTER_URL}/v1/upload/presign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AURA_USER_JWT}`,
    },
    body: JSON.stringify({
      content_type: contentType,
      filename: `zos-avatar-${mediaId}.${ext}`,
    }),
  });
  if (!presignResp.ok) {
    console.warn(`  presign failed: ${presignResp.status} ${await presignResp.text()}`);
    return null;
  }
  const { upload_url, file_url } = await presignResp.json();

  // 2. Upload to S3
  const uploadResp = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: imageBuffer,
  });
  if (!uploadResp.ok) {
    console.warn(`  S3 upload failed: ${uploadResp.status}`);
    return null;
  }

  return file_url;
}

async function updateAuraNetwork(userId, s3Url) {
  await pool.query(
    `UPDATE users SET profile_image = $2, updated_at = NOW() WHERE id = $1`,
    [userId, s3Url],
  );
  await pool.query(
    `UPDATE profiles SET avatar = $2, updated_at = NOW() WHERE user_id = $1 AND profile_type = 'user'`,
    [userId, s3Url],
  );
}

async function main() {
  // Find users that need avatars: no avatar, or stale mxc/matrix URLs
  const { rows: users } = await pool.query(`
    SELECT u.id, u.zero_user_id, u.display_name, u.profile_image
    FROM users u
    WHERE u.zero_user_id IS NOT NULL
      AND u.zero_user_id != ''
      AND (
        u.profile_image IS NULL
        OR u.profile_image = ''
        OR u.profile_image LIKE 'mxc://%'
        OR u.profile_image LIKE '%/_matrix/%'
      )
    ORDER BY u.created_at
  `);

  console.log(`Found ${users.length} users needing avatar backfill\n`);

  let success = 0;
  let noAvatar = 0;
  let failed = 0;

  for (const user of users) {
    const label = `${user.display_name || user.zero_user_id} (${user.id})`;
    process.stdout.write(`${label}: `);

    // 1. Get mxc:// URL from Matrix
    const mxcUrl = await getMatrixAvatarUrl(user.zero_user_id);
    if (!mxcUrl) {
      console.log("no Matrix avatar");
      noAvatar++;
      continue;
    }

    const parsed = parseMxc(mxcUrl);
    if (!parsed) {
      console.log(`unexpected avatar format: ${mxcUrl}`);
      failed++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`would rehost ${mxcUrl}`);
      success++;
      continue;
    }

    // 2. Download from Matrix
    const media = await downloadMatrixMedia(parsed.server, parsed.mediaId);
    if (!media) {
      failed++;
      continue;
    }

    // 3. Upload to S3
    const s3Url = await uploadToS3(media.buffer, media.contentType, parsed.mediaId);
    if (!s3Url) {
      failed++;
      continue;
    }

    // 4. Update aura-network
    await updateAuraNetwork(user.id, s3Url);
    console.log(`done → ${s3Url}`);
    success++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`Success: ${success}`);
  console.log(`No Matrix avatar: ${noAvatar}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${users.length}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
