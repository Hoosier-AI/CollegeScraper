import { describe, it, expect } from 'vitest';
import { ruleMatches } from '../../src/http/robots.js';
describe('robots wildcards', () => {
  it('reads * and $ the way Wikidata uses them', () => {
    expect(ruleMatches('/wiki/Special:EntityData/*.', '/wiki/Special:EntityData/Q42.json')).toBe(true);
    expect(ruleMatches('/wiki/Special:EntityData/*.', '/wiki/Special:EntityData/Q42')).toBe(false);
    expect(ruleMatches('/wiki/Special:EntityData/', '/wiki/Special:EntityData/Q42.json')).toBe(true);
    expect(ruleMatches('/*.pdf$', '/files/a.pdf')).toBe(true);
    expect(ruleMatches('/*.pdf$', '/files/a.pdf?x=1')).toBe(false);
    expect(ruleMatches('/w/', '/wiki/Foo')).toBe(false);
  });
});
