// The page state, its saving, hash routing and the simulated task clock.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { App } from 'antd';
import { ApiError, resetState, saveState, submitPullRequest, type Boot, type SubmitRequest } from './api.ts';
import { home, parseHash, type Route } from './navigation.ts';
import { project, taskName } from './demo/model.ts';
import { finishRun, runProgress } from './demo/runs.ts';
import type { Role, TalentsState, TeamsInfo } from './types.ts';

export interface Talents {
  state: TalentsState; teams: TeamsInfo; route: Route; role: Role;
  /** The project the user came for (?project=, e.g. from a Teams link); pages preselect it. */
  focusProject: string | null;
  /** Milliseconds now; advances while tasks run so progress redraws. */
  clock: number;
  /** Changes a copy of the state, shows it and saves it; returns what the recipe returns. */
  update<T>(recipe: (draft: TalentsState) => T): T;
  reset(): Promise<void>;
  submit(request: SubmitRequest): Promise<void>;
  go(hash: string): void;
  /** Rewrites the current hash without adding a history entry (e.g. to drop ?new=1 once handled). */
  replace(hash: string): void;
  toast(text: string): void;
  teamsLink(projectId?: string | null): string;
}
const Context = createContext<Talents | null>(null);
export function useTalents() { const value = useContext(Context); if (!value) throw new Error('Talents context missing'); return value; }

function routeOf(state: TalentsState, hash: string): Route {
  const { page, params } = parseHash(hash);
  return page ? { page, params } : { page: parseHash('#/' + home[state.role]).page!, params: {} };
}

export function TalentsProvider({ boot, children }: { boot: Boot; children: ReactNode }) {
  const { message } = App.useApp();
  const [state, setState] = useState(boot.state), stateRef = useRef(boot.state);
  const [teams, setTeams] = useState(boot.teams);
  const [route, setRoute] = useState(() => routeOf(boot.state, location.hash));
  const [focusProject, setFocusProject] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const toast = useCallback((text: string) => { void message.info(text); }, [message]);

  // Saves are queued: one request at a time, and changes made while a save is in flight go in the next one.
  const saver = useRef({ revision: boot.revision, saving: null as Promise<void> | null, dirty: false });
  const save = useCallback((): Promise<void> => {
    const s = saver.current;
    s.dirty = true;
    if (!s.saving) s.saving = (async () => {
      s.dirty = false;
      try {
        s.revision = (await saveState(s.revision, stateRef.current)).revision;
        s.saving = null;
        if (s.dirty) await save();
      } catch (e) {
        s.saving = null;
        if (e instanceof ApiError && e.status === 409) { toast('数据已在另一页面更新，正在刷新'); setTimeout(() => location.reload(), 1200); return; }
        toast('保存失败：' + (e as Error).message);
      }
    })();
    return s.saving;
  }, [toast]);
  const update = useCallback(<T,>(recipe: (draft: TalentsState) => T): T => {
    const next = structuredClone(stateRef.current);
    const result = recipe(next);
    stateRef.current = next; setState(next); void save();
    return result;
  }, [save]);
  const reset = useCallback(async () => {
    await saver.current.saving;
    const fresh = await resetState();
    saver.current.revision = fresh.revision;
    stateRef.current = fresh.state; setState(fresh.state); setTeams(fresh.teams);
  }, []);
  const submit = useCallback(async (request: SubmitRequest) => {
    await saver.current.saving;
    const fresh = await submitPullRequest(request);
    saver.current.revision = fresh.revision;
    stateRef.current = fresh.state; setState(fresh.state);
  }, []);

  // Routing: hash changes and go() both parse the hash, so a role switch and its page change render together.
  const go = useCallback((hash: string) => {
    if (location.hash !== hash) location.hash = hash;
    setRoute(routeOf(stateRef.current, hash));
  }, []);
  const replace = useCallback((hash: string) => {
    history.replaceState(null, '', location.pathname + location.search + hash);
    setRoute(routeOf(stateRef.current, hash));
  }, []);
  useEffect(() => {
    const change = () => { setRoute(routeOf(stateRef.current, location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  // An unknown page shows the entry's home; keep the address in step.
  useEffect(() => {
    if (parseHash(location.hash).page) return;
    history.replaceState(null, '', location.pathname + location.search + '#/' + route.page.id);
  }, [route]);
  useEffect(() => { if (route.params.project && project(state, route.params.project)) setFocusProject(route.params.project); }, [route, state]);
  // Every page belongs to the owner's workspace.
  const role = route.page.role;
  useEffect(() => { if (stateRef.current.role !== role) update(s => { s.role = role; }); }, [role, update]);
  useEffect(() => { document.title = route.page.title + ' · iCode Talents'; }, [route]);

  // Running tasks: advance the clock, and finish the ones whose time is up.
  useEffect(() => {
    const timer = setInterval(() => {
      const running = stateRef.current.tasks.filter(t => t.status === 'running');
      if (!running.length) return;
      setClock(Date.now());
      const done = running.filter(t => runProgress(t).done).map(t => t.id);
      if (!done.length) return;
      const names = update(s => s.tasks.filter(t => done.includes(t.id)).map(t => { finishRun(s, t); return taskName(s, t); }));
      names.forEach(name => toast('任务完成：' + name));
    }, 700);
    return () => clearInterval(timer);
  }, [update, toast]);

  const teamsLink = useCallback((projectId?: string | null) => {
    const pid = projectId ?? focusProject ?? stateRef.current.projects[0]?.id ?? 'carddemo';
    const url = new URL('/teams', teams.origin);
    url.searchParams.set('demo-role', role === 'admin' ? 'owner' : 'member');
    url.hash = '/projects?project=' + encodeURIComponent(pid) + '&tab=content';
    return url.toString();
  }, [focusProject, role, teams.origin]);

  const value = useMemo<Talents>(() => ({ state, teams, route, role, focusProject, clock, update, reset, submit, go, replace, toast, teamsLink }),
    [state, teams, route, role, focusProject, clock, update, reset, submit, go, replace, toast, teamsLink]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
