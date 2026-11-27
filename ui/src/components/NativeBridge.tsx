// Everything the phone app does that the website does not, in one place: the status bar, links that leave the app,
// links into it (universal links and taps on a score alert), fresh numbers when the app comes back to the front,
// follows that survive iOS clearing web storage, My teams as the first screen, a line when the phone is offline,
// and the one-time question about score alerts. Mounted by App only in the app's build.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useFollows } from '../lib/follows';
import { alertsAsked, enableAlerts, markAlertsAsked, restoreStorage, startPush, syncFollows } from '../lib/push';

const OUR_HOST = /(^|\.)plaibook\.live$/;

export function NativeBridge() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const follows = useFollows();
  const [offline, setOffline] = useState(false);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    const off: (() => void)[] = [];
    let gone = false;
    (async () => {
      await restoreStorage();
      const [{ App }, { StatusBar, Style }, { Browser }, { SplashScreen }, { Network }] = await Promise.all([import('@capacitor/app'), import('@capacitor/status-bar'), import('@capacitor/browser'), import('@capacitor/splash-screen'), import('@capacitor/network')]);
      if (gone) return;
      void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      // First screen: My teams when the reader follows anything, Scores otherwise.
      try { if (window.location.pathname === '/' && JSON.parse(localStorage.getItem('plaibook-stats:follows:v1') ?? '[]').length) navigate('/following', { replace: true }); } catch { /* stays on Scores */ }
      void SplashScreen.hide().catch(() => {});
      const open = await App.addListener('appUrlOpen', ({ url }) => { try { const u = new URL(url); if (OUR_HOST.test(u.hostname)) navigate(u.pathname + u.search); } catch { /* not a link of ours */ } });
      const front = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) void qc.invalidateQueries(); });
      const net = await Network.addListener('networkStatusChange', (s) => { setOffline(!s.connected); if (s.connected) void qc.invalidateQueries(); });
      void Network.getStatus().then((s) => setOffline(!s.connected)).catch(() => {});
      // A link to another site opens in the in-app browser sheet, so the reader never loses the app.
      const onClick = (e: MouseEvent) => {
        const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        const href = a?.getAttribute('href') ?? '';
        if (!/^https?:\/\//i.test(href)) return;
        let host = ''; try { host = new URL(href).hostname; } catch { return; }
        e.preventDefault();
        if (OUR_HOST.test(host)) { const u = new URL(href); navigate(u.pathname + u.search); } else void Browser.open({ url: href });
      };
      document.addEventListener('click', onClick, true);
      const stopPush = await startPush((to) => navigate(to));
      syncFollows();
      off.push(() => void open.remove(), () => void front.remove(), () => void net.remove(), () => document.removeEventListener('click', onClick, true), stopPush);
      if (gone) off.forEach((f) => f());
    })();
    return () => { gone = true; off.forEach((f) => f()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The alerts question: once, after the first follow, never on launch. iOS's own prompt only follows a yes here.
  useEffect(() => { if (follows.length > 0 && !alertsAsked()) setAsk(true); }, [follows.length]);
  // The sheet does not sit over a page change the reader did not make.
  useEffect(() => { if (ask && alertsAsked()) setAsk(false); }, [pathname, ask]);

  return (
    <>
      {offline && <p role="status" className="fixed inset-x-0 z-40 bg-field-800 px-3.5 py-1.5 text-center text-xs text-chalk-200" style={{ top: 'var(--topbar-h)' }}>You are offline. Showing the last scores this phone loaded.</p>}
      {ask && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
          <button type="button" aria-label="Not now" className="absolute inset-0 bg-black/60" onClick={() => { markAlertsAsked('later'); setAsk(false); }} />
          <div role="dialog" aria-modal="true" aria-labelledby="alerts-title" className="relative w-full max-w-md rounded-t-2xl bg-field-900 p-5 shadow-2xl shadow-black/60" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
            <h2 id="alerts-title" className="display flex items-center gap-2 text-xl text-chalk-100"><Bell size={20} aria-hidden className="text-pitch-300" />Score alerts for {follows[0]?.name ?? 'your teams'}?</h2>
            <p className="mt-2 text-sm text-chalk-300">Kick-off, goals and the final score for everything you follow. Change it any time in My teams.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn-primary flex-1" onClick={() => { setAsk(false); void enableAlerts(); }}>Turn on alerts</button>
              <button type="button" className="btn-ghost flex-1" onClick={() => { markAlertsAsked('later'); setAsk(false); }}>Not now</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
