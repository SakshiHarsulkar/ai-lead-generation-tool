/**
 * robots.txt support (RFC 9309): groups, Allow/Disallow, `*` wildcards, `$` anchors,
 * longest-match-wins with Allow winning ties.
 */
export function parseRobots(text, agentToken = 'leadlensbot') {
  const groups = [];
  let current = null;
  let lastLineWasAgent = false;

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (current && (key === 'allow' || key === 'disallow') && value) {
      current.rules.push({ allow: key === 'allow', path: value });
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agentToken.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function patternMatches(pattern, path) {
  let source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  if (source.endsWith('\\$')) source = `${source.slice(0, -2)}$`;
  return new RegExp(`^${source}`).test(path);
}

export function isAllowed(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (!patternMatches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

/** Interpret a robots.txt fetch result per RFC 9309 §2.3.1. */
export function rulesFromResponse(page) {
  if (!page || page.status === 0) return []; // unreachable -> treat as no restrictions
  if (page.status >= 200 && page.status < 300) return parseRobots(page.body);
  if (page.status >= 500) return [{ allow: false, path: '/' }]; // server error -> assume full disallow
  return []; // 4xx -> no robots.txt
}
