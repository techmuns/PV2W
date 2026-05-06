#!/usr/bin/env node
/**
 * write-meta.mjs
 *
 * Stamps refresh status onto data/config/placeholder_data.json under
 * a `_meta` block so the dashboard can render "Last refreshed: …" /
 * "fetcher X failed" without the user needing to open GitHub Actions.
 *
 * Reads each fetcher step's outcome via env vars set by the workflow.
 * Always writes a status, even if every fetcher failed — the meta
 * block itself is the contract the dashboard reads.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');

const fetchers = {
  stock_prices:        process.env.STOCK_OUTCOME        || 'unknown',
  maruti_yahoo:        process.env.MARUTI_YAHOO_OUTCOME || 'unknown',
  maruti_press:        process.env.MARUTI_PRESS_OUTCOME || 'unknown',
  hyundai:             process.env.HYUNDAI_OUTCOME      || 'unknown',
};

const outcomes = Object.values(fetchers);
const allOk    = outcomes.every(o => o === 'success');
const allBad   = outcomes.every(o => o === 'failure' || o === 'unknown');
const status   = allOk ? 'ok' : (allBad ? 'error' : 'partial');

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
data._meta = data._meta || {};
data._meta.last_refresh    = new Date().toISOString();
data._meta.status          = status;
data._meta.fetchers        = fetchers;
data._meta.run_url         = process.env.RUN_URL || null;

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
console.log('[write-meta] _meta:', JSON.stringify(data._meta, null, 2));
