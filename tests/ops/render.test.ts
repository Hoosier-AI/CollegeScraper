import { describe, it, expect } from 'vitest';
import { maskEnv, mergeEnv } from '../../src/ops/render.js';

const cur = [{ key: 'SUPABASE_URL', value: 'https://x.supabase.co' }, { key: 'LOG_LEVEL', value: 'info' }, { key: 'COLLEGE_API_KEYS', value: 'plaibook:abcdefghijklmnop' }];

describe('render env', () => {
  it('masks secrets and marks protected keys', () => {
    const m = maskEnv(cur);
    expect(m.find((v) => v.key === 'COLLEGE_API_KEYS')).toMatchObject({ secret: true, protected: false });
    expect(m.find((v) => v.key === 'COLLEGE_API_KEYS')!.value).toMatch(/^pla•+$/);
    expect(m.find((v) => v.key === 'SUPABASE_URL')).toMatchObject({ protected: true });
    expect(m.find((v) => v.key === 'LOG_LEVEL')).toMatchObject({ value: 'info', secret: false });
  });
  it('merges edits and refuses protected or malformed keys', () => {
    expect(mergeEnv(cur, { set: { LOG_LEVEL: 'warn', NEW_FLAG: '1' }, remove: ['COLLEGE_API_KEYS'] })).toEqual([{ key: 'LOG_LEVEL', value: 'warn' }, { key: 'NEW_FLAG', value: '1' }, { key: 'SUPABASE_URL', value: 'https://x.supabase.co' }]);
    expect(() => mergeEnv(cur, { set: { SUPABASE_URL: 'x' } })).toThrow(/dashboard/);
    expect(() => mergeEnv(cur, { remove: ['RENDER_API_KEY'] })).toThrow(/dashboard/);
    expect(() => mergeEnv(cur, { set: { 'bad-name': 'x' } })).toThrow(/valid/);
  });
});
