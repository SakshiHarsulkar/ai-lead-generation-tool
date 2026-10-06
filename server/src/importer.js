import { FREE_EMAIL_DOMAINS, normalizeCompany, normalizeDomain } from './normalizer.js';

const DOMAIN_HEADERS = ['website', 'domain', 'url', 'site', 'web', 'homepage', 'company website', 'company domain', 'website url'];
const COMPANY_HEADERS = ['company', 'company name', 'name', 'organization', 'organisation', 'business', 'account', 'account name'];
const EMAIL_HEADERS = ['email', 'email address', 'e-mail', 'work email'];

/** Minimal RFC-4180 parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  rows.push(row);
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

function detectDelimiter(firstLine) {
  const counts = { ',': 0, '\t': 0, ';': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch]++;
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

const findColumn = (header, candidates) => header.findIndex((h) => candidates.includes(h));

/**
 * Turns whatever the user pasted or uploaded (CRM export, spreadsheet copy, list of URLs or emails)
 * into a clean, de-duplicated company list, and reports exactly what was dropped and why.
 */
export function parseLeadInput(text, maxLeads = 500) {
  const clean = String(text ?? '').replace(/^﻿/, '').trim();
  if (!clean) return { leads: [], duplicates: [], invalid: [] };

  const rows = parseCsv(clean, detectDelimiter(clean.split(/\r?\n/)[0]));
  const header = rows[0].map((c) => c.toLowerCase());
  const domainCol = findColumn(header, DOMAIN_HEADERS);
  const companyCol = findColumn(header, COMPANY_HEADERS);
  const emailCol = findColumn(header, EMAIL_HEADERS);
  const hasHeader = domainCol >= 0 || companyCol >= 0 || emailCol >= 0;
  if (hasHeader) rows.shift();

  const leads = [];
  const duplicates = [];
  const invalid = [];
  const seen = new Set();

  for (const row of rows) {
    let domain = null;
    let company = '';

    if (hasHeader) {
      if (domainCol >= 0) domain = normalizeDomain(row[domainCol]);
      if (!domain && emailCol >= 0) domain = normalizeDomain(row[emailCol]);
      if (companyCol >= 0) company = row[companyCol] ?? '';
    } else {
      // No header: the first cell that looks like a domain/URL/email wins, the first other cell is the name.
      for (const cell of row) {
        if (!domain && cell.includes('.') && normalizeDomain(cell)) domain = normalizeDomain(cell);
        else if (!company && cell) company = cell;
      }
    }

    const original = row.filter(Boolean).join(', ');
    if (!domain) {
      const freeMail = row.some((c) => FREE_EMAIL_DOMAINS.has(c.toLowerCase().split('@')[1] ?? ''));
      invalid.push({ row: original, reason: freeMail ? 'Personal email domain (gmail, yahoo...)' : 'No valid website or domain' });
      continue;
    }
    if (seen.has(domain)) {
      duplicates.push({ row: original, domain });
      continue;
    }
    if (leads.length >= maxLeads) {
      invalid.push({ row: original, reason: `Over the ${maxLeads}-company limit` });
      continue;
    }
    seen.add(domain);
    leads.push({ company: normalizeCompany(company, domain), domain });
  }

  return { leads, duplicates, invalid };
}
