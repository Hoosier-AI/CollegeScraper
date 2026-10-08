// A pro address that is not (or no longer) a page: follow a renamed slug when the API says where it went.
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { proPath } from '../../lib/pro';
import { EmptyState } from '../../components/primitives';

const PATH = { league: proPath.league, team: proPath.team, player: proPath.player, match: proPath.match } as const;
const API = { league: 'leagues', team: 'teams', player: 'players', match: 'matches' } as const;

export function ProMoved({ kind, slug }: { kind: keyof typeof PATH; slug: string }) {
  const nav = useNavigate();
  // The 404 body carries `moved` when the slug was renamed.
  const q = useQuery({ queryKey: ['pro-moved', kind, slug], queryFn: async () => (await (await fetch(`/api/pro/${API[kind]}/${slug}`)).json()) as { moved?: string | null }, retry: false });
  useEffect(() => { if (q.data?.moved) nav(PATH[kind](q.data.moved), { replace: true }); }, [q.data, kind, nav]);
  return <EmptyState title="Not found" body="This page may have moved, or the link was cut short." action={<Link className="btn-ghost btn-sm" to={proPath.home}>Plaibook Stats Pro</Link>} />;
}
