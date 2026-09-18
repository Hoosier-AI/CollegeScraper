// OpenAPI 3.1 description of the public read API (served at /v1/openapi.json).
import { PLAYER_STATS, TEAM_STATS } from '../ui/queries.js';

const uuid = { type: 'string', format: 'uuid' };
const season = { name: 'season', in: 'query', required: true, schema: { type: 'integer', minimum: 2000, maximum: 2100 }, description: 'Fall season year, e.g. 2026.' };
const gender = { name: 'gender', in: 'query', schema: { type: 'string', enum: ['m', 'w'] } };
const division = { name: 'division', in: 'query', schema: { type: 'string', enum: ['d1', 'd2', 'd3'] } };
const conference = { name: 'conference', in: 'query', schema: uuid, description: 'college_conferences.id' };
const ok = (description: string) => ({ 200: { description, content: { 'application/json': { schema: { type: 'object' } } } }, 400: { $ref: '#/components/responses/BadRequest' }, 401: { $ref: '#/components/responses/Unauthorized' }, 429: { $ref: '#/components/responses/RateLimited' } });

export function openapiSpec(serverUrl: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Plaibook Stats API',
      version: '1.0.0',
      description: 'Read-only NCAA soccer data (D1/D2/D3, men and women): programs, rosters, players, games, season stats, standings and rankings. Data is crawled from each school\'s athletics site, NCAA.com, conference websites and unitedsoccercoaches.org.\n\n**No API key is required.** Every route answers anonymous requests at the free-tier limit (per client IP, see `limits` in /v1/meta), and keyless responses are readable from any origin. A named key — `Authorization: Bearer <key>` or `X-Api-Key: <key>` — raises the limit and is restricted to the origins configured on the service.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', description: 'Optional: a named key raises the rate limit.' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-Api-Key', description: 'Optional: same key, sent as a header.' },
      },
      responses: {
        BadRequest: { description: 'A parameter is missing or malformed.' },
        Unauthorized: { description: 'A key was sent and it is not valid. Sending no key at all uses the free tier.' },
        RateLimited: { description: 'Request limit exceeded; see Retry-After and X-RateLimit-* headers.' },
      },
    },
    // {} first: no credentials is a supported way to call every route.
    security: [{}, { apiKey: [] }, { apiKeyHeader: [] }],
    paths: {
      '/v1/meta': { get: { summary: 'Seasons, conferences and data freshness', responses: ok('Seasons, current season, divisions, conferences and last successful crawl runs.') } },
      '/v1/status': { get: { summary: 'Crawl health', responses: ok('Recent crawl runs, record-check counts, member programs and games/finals stored.') } },
      '/v1/search': { get: { summary: 'Search programs and players by name', parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 60 } }, gender, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } }], responses: ok('{ q, programs[], players[] } ordered by similarity.') } },
      '/v1/programs': { get: { summary: 'Programs for a season', parameters: [season, gender, division, conference, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'members', in: 'query', schema: { type: 'string', enum: ['all'] }, description: 'Include non-NCAA opponents (default: NCAA members only).' }], responses: ok('One row per program with school, conference, membership, computed and official records, sync timestamps and game counts.') } },
      '/v1/programs/{id}': { get: { summary: 'One program with roster, games, standing and rankings', parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }, { ...season, required: false }, { name: 'include', in: 'query', schema: { type: 'string' }, description: 'Comma list of roster,games (default both).' }], responses: ok('program, school, season row, coaches, team stats, standing, conference table, USC poll history, NCAA category ranks, roster (with season stats, school-table stats, splits, honors) and games with team stats.') } },
      '/v1/programs/{id}/roster': { get: { summary: 'Roster with season stats', parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }, season], responses: ok('Players with computed season stats, the school\'s own cumulative stats, splits and honors.') } },
      '/v1/programs/{id}/games': { get: { summary: 'Schedule and results', parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }, season], responses: ok('Games in date order with both sides\' team-stat rows and the truth source.') } },
      '/v1/players/{id}': { get: { summary: 'Player with seasons, career, splits, ranks, honors, game log', parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }], responses: ok('player, seasons[], career, honors[], transfers[], gameLog[].') } },
      '/v1/games/{id}': { get: { summary: 'Box score', parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }, { name: 'include', in: 'query', schema: { type: 'string' }, description: '`raw` adds the source payloads.' }], responses: ok('game header, team stats (both sources), player lines, events.') } },
      '/v1/leaders': { get: { summary: 'Leaderboards', parameters: [season, gender, division, conference, { name: 'kind', in: 'query', schema: { type: 'string', enum: ['player', 'team'] } }, { name: 'stat', in: 'query', schema: { type: 'string', enum: [...PLAYER_STATS, ...TEAM_STATS] } }, { name: 'min_minutes', in: 'query', schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500, default: 100 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }, { name: 'q', in: 'query', description: 'Player or program name contains', schema: { type: 'string' } }, { name: 'members', in: 'query', schema: { type: 'string', enum: ['all'] } }], responses: ok('{ stats: allowed stat names, stat, rows[], total, limit, offset } — one page sorted by the stat (ascending for goals-against style stats); page with offset until offset + rows.length >= total.') } },
      '/v1/standings': { get: { summary: 'Standings by conference', parameters: [season, gender, division, conference], responses: ok('{ source, official, computed, conferences: [{ conference, source, source_url, rows[] }] }; each row carries checks[] against the official table.') } },
      '/v1/rankings': { get: { summary: 'Polls and NCAA category ranks', parameters: [season, gender, division, { name: 'poll', in: 'query', schema: { type: 'string' }, description: "'usc' (United Soccer Coaches, default) or 'ncaa:<categoryId>'." }, { name: 'week_of', in: 'query', schema: { type: 'string', format: 'date' } }], responses: ok('{ polls[], poll, weeks[], week, rows[] } with rank, previous_rank, first_place_votes, points, record per row.') } },
      '/v1/openapi.json': { get: { summary: 'This document', security: [], responses: { 200: { description: 'OpenAPI 3.1' } } } },
    },
  };
}
