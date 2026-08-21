import {
  PORT_FORWARD_RUNNING_STATUS,
  PORT_FORWARD_STOP_STATUS,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { ConfiguredForwards, ListRow, PortForwardEntry, SharedPortForward } from './types';

/** Upper bound for the collision suffix; far above any realistic config. */
const MAX_ID_ATTEMPTS = 1000;

/** The id a configured forward derives when the JSON does not give one. */
export function getBaseForwardId(pf: SharedPortForward): string {
  return pf.id || `${pf.namespace}-${pf.service}-${pf.targetPort}`;
}

/**
 * Indexes the configured forwards by the id they get at runtime.
 *
 * Derived ids are shared by entries that differ only in the local port, and
 * such entries used to collapse into a single map slot: one forward silently
 * disappeared from the list and never started. Colliding entries now get the
 * local port appended. The first occurrence keeps its plain id, so ids that
 * work today are untouched and nothing needs migrating.
 *
 * Local entries are claimed before external ones, so a change in what the URL
 * serves cannot renumber the locally owned ones.
 */
export function buildForwardIndex(
  local: SharedPortForward[] | undefined,
  external: SharedPortForward[] | undefined
): ConfiguredForwards {
  const taken = new Set<string>();

  function claim(pf: SharedPortForward): string {
    const base = getBaseForwardId(pf);
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }

    const withPort = `${base}-${pf.localPort}`;
    if (!taken.has(withPort)) {
      taken.add(withPort);
      return withPort;
    }

    for (let n = 2; n < MAX_ID_ATTEMPTS; n++) {
      const candidate = `${withPort}-${n}`;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }

    return `${withPort}-${taken.size}`;
  }

  const index: ConfiguredForwards = { local: new Map(), external: new Map() };
  (local ?? []).forEach(pf => index.local.set(claim(pf), pf));
  (external ?? []).forEach(pf => index.external.set(claim(pf), pf));
  return index;
}

/**
 * The configured forwards as a flat list, ids included.
 *
 * The auto-starter has to name the forwards it creates exactly as the list
 * expects them, so it must read the ids off the same index rather than deriving
 * them again per entry.
 */
export function flattenForwardIndex(
  index: ConfiguredForwards
): Array<{ id: string; entry: SharedPortForward; source: 'local' | 'external' }> {
  const flat: Array<{ id: string; entry: SharedPortForward; source: 'local' | 'external' }> = [];
  index.local.forEach((entry, id) => flat.push({ id, entry, source: 'local' }));
  index.external.forEach((entry, id) => flat.push({ id, entry, source: 'external' }));
  return flat;
}

/**
 * What a forward actually forwards, as a comparable string.
 *
 * Rows and configured entries are matched on this rather than only on the id.
 * The id of a configured entry is derived from its fields, so any difference in
 * how it was produced - a hand-written id, a collision suffix, a value stored
 * as a number instead of a string - silently breaks the lookup, and the row
 * then looks unconfigured: no name, no auto-start, offered for sharing again.
 * The target itself cannot drift like that.
 */
export function forwardIdentity(pf: {
  namespace?: string;
  serviceNamespace?: string;
  service?: string;
  pod?: string;
  targetPort?: string | number;
  port?: string | number;
  localPort?: string | number;
}): string {
  const namespace = pf.serviceNamespace || pf.namespace || '';
  const target = pf.service || pf.pod || '';
  const local = pf.port ?? pf.localPort ?? '';
  return `${namespace}/${target}/${pf.targetPort ?? ''}/${local}`;
}

/**
 * The configured forward behind a row, if the row comes from configuration.
 *
 * Tries the id first, then falls back to what the forward targets.
 */
export function findConfigured(
  configured: ConfiguredForwards,
  portForward: PortForwardEntry
): { entry: SharedPortForward; source: 'local' | 'external' } | undefined {
  const byId = configured.external.get(portForward.id) ?? configured.local.get(portForward.id);
  if (byId) {
    return {
      entry: byId,
      source: configured.external.has(portForward.id) ? 'external' : 'local',
    };
  }

  const identity = forwardIdentity(portForward);

  for (const entry of configured.external.values()) {
    if (forwardIdentity(entry) === identity) {
      return { entry, source: 'external' };
    }
  }
  for (const entry of configured.local.values()) {
    if (forwardIdentity(entry) === identity) {
      return { entry, source: 'local' };
    }
  }

  return undefined;
}

/**
 * Total order for the list.
 *
 * The backend serves /portforward/list from a Go map, so its order is
 * randomised on every poll - without a sort of our own the rows would visibly
 * reshuffle every few seconds and move out from under the cursor. Ends with the
 * id so the order is total and never depends on input order.
 */
export function compareForwards(a: PortForwardEntry, b: PortForwardEntry): number {
  const byName = (a.service || a.pod || '').localeCompare(b.service || b.pod || '');
  if (byName !== 0) {
    return byName;
  }

  const byPort = (Number(a.port) || 0) - (Number(b.port) || 0);
  if (byPort !== 0) {
    return byPort;
  }

  return a.id.localeCompare(b.id);
}

export function isRunning(pf: PortForwardEntry): boolean {
  return pf.status === PORT_FORWARD_RUNNING_STATUS;
}

/**
 * Whether the forward can be started again.
 *
 * Deliberately the exact complement of isRunning, so every row has one primary
 * action and none falls through the gap. In particular a stopped forward that
 * still carries an error is resumable: those errors are historical (typically
 * "pod is not running" after a pod restart) and resuming is what clears them,
 * because the start path re-resolves the pod first.
 */
export function isStopped(pf: PortForwardEntry): boolean {
  return !isRunning(pf);
}

/**
 * Rows for configured forwards that are neither running nor remembered as
 * stopped.
 *
 * Without auto-start a forward may never have run, so nothing would put it in
 * localStorage and it would be missing from the list entirely - leaving no way
 * to start it by hand. These synthetic rows make it visible and startable.
 */
export function synthesizeMissingRows(
  configured: ConfiguredForwards,
  existing: PortForwardEntry[],
  cluster: string
): PortForwardEntry[] {
  if (!cluster) {
    return [];
  }

  const known = new Set(existing.map(pf => pf.id));

  return flattenForwardIndex(configured)
    .filter(({ id }) => {
      if (known.has(id)) {
        return false;
      }
      known.add(id);
      return true;
    })
    .map(({ id, entry }) => ({
      id,
      pod: entry.pod || '',
      service: entry.service || '',
      serviceNamespace: entry.serviceNamespace || entry.namespace,
      namespace: entry.namespace,
      cluster,
      port: String(entry.localPort ?? ''),
      targetPort: String(entry.targetPort),
      status: PORT_FORWARD_STOP_STATUS,
      error: '',
    }));
}

/**
 * The user-given name of a forward, when it adds information.
 *
 * Shared ports JSON entries carry names like "Redis Cache" that are far more
 * telling than the service name. Skipped when it is just the id or repeats the
 * resource name, so the column does not show noise.
 */
export function getForwardLabel(
  portForward: PortForwardEntry,
  configured: ConfiguredForwards
): string | undefined {
  const name = findConfigured(configured, portForward)?.entry.name?.trim();

  if (!name || name === portForward.id) {
    return undefined;
  }
  if (name === portForward.service || name === portForward.pod) {
    return undefined;
  }
  return name;
}

/**
 * Resolves each row against the configuration, once.
 *
 * Every cell then renders from its own row object, so no two cells can reach
 * different conclusions about the same forward.
 */
export function decorateRows(rows: PortForwardEntry[], configured: ConfiguredForwards): ListRow[] {
  return rows.map(pf => {
    const match = findConfigured(configured, pf);
    const label = getForwardLabel(pf, configured);
    const autoStart = match?.entry.autoStart === true;
    const running = isRunning(pf);

    return {
      ...pf,
      configuredSource: match?.source,
      configuredEntry: match?.entry,
      label,
      autoStart,
      running,
      renderKey: [
        pf.id,
        pf.status ?? '',
        pf.error ? 'err' : '',
        pf.port ?? '',
        match?.source ?? '',
        autoStart ? 'auto' : '',
        label ?? '',
      ].join('|'),
    };
  });
}
