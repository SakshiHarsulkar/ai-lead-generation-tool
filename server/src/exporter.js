// CSV exports shaped for the tools sales teams already use, so leads land in the CRM with zero re-mapping.

function cell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // CSV-injection guard: spreadsheet apps execute cells starting with these characters.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (header, rows) => `﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

function common(lead) {
  const e = lead.enrichment ?? {};
  const sc = lead.scoring ?? {};
  return {
    e,
    sc,
    email: e.primaryEmail?.email ?? '',
    emailStatus: e.primaryEmail?.status ?? '',
    phone: e.phones?.[0]?.display ?? '',
    website: e.finalUrl ?? `https://${lead.domain}`,
    linkedin: e.socials?.linkedin ?? '',
    opener: lead.insight?.opener ?? sc.opener ?? '',
    reasons: (sc.breakdown ?? []).filter((b) => b.hit).map((b) => `+${b.points} ${b.label}`).join('; '),
    description: lead.insight?.summary ?? e.description ?? '',
  };
}

const FORMATS = {
  csv: {
    header: ['Company', 'Domain', 'Website', 'Score', 'Tier', 'Primary Email', 'Email Status', 'All Valid Emails', 'Phone', 'LinkedIn', 'Twitter/X', 'Facebook', 'Tech Stack', 'Founded', 'Hiring', 'Suggested Opener', 'Score Reasons', 'Description'],
    row: (lead) => {
      const c = common(lead);
      return [
        lead.company, lead.domain, c.website, lead.score ?? '', lead.tier ?? '', c.email, c.emailStatus,
        (c.e.emails ?? []).filter((x) => x.status !== 'invalid').map((x) => x.email).join('; '),
        c.phone, c.linkedin, c.e.socials?.twitter ?? '', c.e.socials?.facebook ?? '',
        (c.e.tech ?? []).map((t) => t.name).join('; '), c.e.signals?.foundedYear ?? '', c.e.signals?.hiring ? 'Yes' : 'No',
        c.opener, c.reasons, c.description,
      ];
    },
  },
  // HubSpot import: these column names auto-map to Company + Contact properties.
  hubspot: {
    header: ['Company name', 'Company Domain Name', 'Website URL', 'Phone Number', 'LinkedIn Company Page', 'Email', 'Lead Status', 'Description', 'LeadLens Score', 'LeadLens Tier', 'LeadLens Opener'],
    row: (lead) => {
      const c = common(lead);
      return [lead.company, lead.domain, c.website, c.phone, c.linkedin, c.email, 'NEW', c.description, lead.score ?? '', lead.tier ?? '', c.opener];
    },
  },
  // Salesforce Lead import: Last Name + Company are required; Rating is the standard Hot/Warm/Cold picklist.
  salesforce: {
    header: ['Last Name', 'Company', 'Website', 'Email', 'Phone', 'Lead Source', 'Rating', 'Description'],
    row: (lead) => {
      const c = common(lead);
      const rating = ['Hot', 'Warm', 'Cold'].includes(lead.tier) ? lead.tier : 'Cold';
      return ['(Unknown)', lead.company, c.website, c.email, c.phone, 'LeadLens', rating, [c.description, c.opener && `Opener: ${c.opener}`, `Score ${lead.score ?? 0}: ${c.reasons}`].filter(Boolean).join('\n')];
    },
  },
};

export function exportLeads(leads, format = 'csv') {
  const spec = FORMATS[format] ?? FORMATS.csv;
  return toCsv(spec.header, leads.map(spec.row));
}

export const EXPORT_FORMATS = Object.keys(FORMATS);
