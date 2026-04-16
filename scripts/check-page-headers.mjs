#!/usr/bin/env node
/**
 * Verifies every HTML page under public/ includes the standard FinLeg header.
 *
 * Requirement: every public-facing HTML page must load `/finleg-header.js`,
 * which injects the shared nav bar with the version indicator.
 *
 * Usage: node scripts/check-page-headers.mjs
 * Exits with code 1 (non-zero) if any page is missing the header.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'public';
const REQUIRED = '/finleg-header.js';
const EXEMPT = new Set([
  // Add filenames (relative to public/) to exempt here, with a reason comment.
  // 'signin.html', // handled separately — example
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const missing = [];

for (const file of files) {
  const rel = file.replace(`${ROOT}/`, '');
  if (EXEMPT.has(rel)) continue;
  const content = readFileSync(file, 'utf8');
  if (!content.includes(REQUIRED)) missing.push(file);
}

if (missing.length > 0) {
  console.error(`\n❌ ${missing.length} HTML page(s) missing the standard FinLeg header (${REQUIRED}):\n`);
  for (const f of missing) console.error(`   - ${f}`);
  console.error(`\nAdd this line inside <body>:`);
  console.error(`   <script src="/finleg-header.js"></script>\n`);
  console.error(`Or add the filename to the EXEMPT set in scripts/check-page-headers.mjs with a reason.\n`);
  process.exit(1);
}

console.log(`✅ All ${files.length} public HTML pages include the standard FinLeg header.`);
