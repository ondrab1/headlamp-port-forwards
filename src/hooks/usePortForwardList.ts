import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  PORT_FORWARD_STOP_STATUS,
  PORT_FORWARDS_STORAGE_KEY,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { buildForwardIndex, mergeStoredForwards } from '../forwards';
import { loadSharedForwards } from '../sharedConfigMap';
import { store } from '../store';
import { ConfiguredForwards, PortForwardEntry, SharedForwardsResult } from '../types';
import { describeError, getForwardAddress, resolvePodForService } from '../utils';

const REFRESH_INTERVAL_MS = 5000;

/**
 * How often the shared ConfigMap is re-read.
 *
 * Slower than the port forward poll on purpose: it changes only when someone
 * shares or renames something, but it does have to change on its own - a
 * colleague's edit would otherwise never show up.
 */
const SHARED_REFRESH_INTERVAL_MS = 30000;

function readStoredForwards(): PortForwardEntry[] {
  try {
    return JSON.parse(localStorage.getItem(PORT_FORWARDS_STORAGE_KEY) || '[]');
  } catch (err) {
    console.error('Failed to parse stored port forwards:', err);
    return [];
  }
}

/**
 * Merges the forwards known to the backend with the ones only present in
 * localStorage (those are the stopped ones) and writes the merged list back.
 *
 * Headlamp always stores the status as "Stopped" because the backend is the
 * source of truth for running forwards; we keep that contract so the built-in
 * port forward buttons on pod/service details keep working.
 */
function mergeWithStorage(running: PortForwardEntry[]): PortForwardEntry[] {
  const merged = mergeStoredForwards(running, readStoredForwards());

  localStorage.setItem(
    PORT_FORWARDS_STORAGE_KEY,
    JSON.stringify(merged.map(pf => ({ ...pf, status: PORT_FORWARD_STOP_STATUS })))
  );

  return merged;
}

function removeFromStorage(id: string) {
  const stored = readStoredForwards().filter(pf => pf.id !== id);
  localStorage.setItem(PORT_FORWARDS_STORAGE_KEY, JSON.stringify(stored));
}

export function usePortForwardList() {
  const cluster = K8s.useCluster() || '';
  const [portForwards, setPortForwards] = React.useState<PortForwardEntry[] | null>(null);
  const [pendingIds, setPendingIds] = React.useState<string[]>([]);

  const fetchList = React.useCallback(async () => {
    if (!cluster) {
      return;
    }

    try {
      const running = (await ApiProxy.listPortForward(cluster)) || [];
      setPortForwards(mergeWithStorage(running as PortForwardEntry[]));
    } catch (err) {
      console.error('Failed to list port forwards:', err);
      setPortForwards(current => current ?? []);
    }
  }, [cluster]);

  React.useEffect(() => {
    setPortForwards(null);
    fetchList();
    const interval = setInterval(fetchList, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchList]);

  const markPending = React.useCallback((ids: string[], pending: boolean) => {
    setPendingIds(current =>
      pending ? [...current, ...ids] : current.filter(id => !ids.includes(id))
    );
  }, []);

  /**
   * Starts a stopped forward again. When the forward targets a service the pod
   * is looked up again first, because the remembered pod is often gone.
   */
  const start = React.useCallback(
    async (pf: PortForwardEntry, port?: string) => {
      const pod = pf.service
        ? await resolvePodForService(cluster, pf.namespace, pf.service, pf.pod)
        : pf.pod;

      if (!pod) {
        throw new Error(`Could not resolve a pod for ${pf.service || pf.id}`);
      }

      await ApiProxy.startPortForward(
        cluster,
        pf.namespace,
        pod,
        pf.targetPort,
        pf.service,
        pf.serviceNamespace,
        port || pf.port,
        getForwardAddress(),
        pf.id
      );
    },
    [cluster]
  );

  const stop = React.useCallback(
    (pf: PortForwardEntry) => ApiProxy.stopOrDeletePortForward(cluster, pf.id, true),
    [cluster]
  );

  /**
   * Deletes the forward, and forgets it locally whatever the backend answers.
   *
   * The backend only knows the forwards it is currently running, so everything
   * else in the list - one restored from localStorage after a restart, one that
   * was configured but never ran, one whose backend record is already gone -
   * makes it fail the delete. That rejection used to abort the cleanup below
   * before it ran, which left exactly the rows the user wants gone as the ones
   * that could not be removed.
   */
  const remove = React.useCallback(
    async (pf: PortForwardEntry) => {
      try {
        await ApiProxy.stopOrDeletePortForward(cluster, pf.id, false);
      } catch (err) {
        // Either there was nothing to delete, or the backend is not answering -
        // and then it is not forwarding anything either. If it does still hold
        // the forward, the next poll lists it again, which is the honest signal.
        console.info(`Backend could not delete port forward ${pf.id}:`, describeError(err));
      }

      removeFromStorage(pf.id);
    },
    [cluster]
  );

  /**
   * Runs an action over several forwards at once, keeping them all marked as
   * pending until every one settled.
   *
   * @returns the error messages of the forwards that failed.
   */
  const runBulk = React.useCallback(
    async (items: PortForwardEntry[], action: (pf: PortForwardEntry) => Promise<unknown>) => {
      if (items.length === 0) {
        return [];
      }

      const ids = items.map(pf => pf.id);
      markPending(ids, true);

      const results = await Promise.allSettled(items.map(pf => action(pf)));

      markPending(ids, false);
      await fetchList();

      return results
        .map((result, index) =>
          result.status === 'rejected'
            ? `${items[index].service || items[index].pod}: ${describeError(result.reason)}`
            : null
        )
        .filter((message): message is string => message !== null);
    },
    [fetchList, markPending]
  );

  return {
    cluster,
    portForwards: portForwards?.filter(pf => pf.cluster === cluster) ?? null,
    pendingIds,
    fetchList,
    start,
    stop,
    remove,
    runBulk,
  };
}

export function useConfiguredForwards(cluster: string): ConfiguredForwards & {
  sharedStatus: SharedForwardsResult | null;
  reloadShared: () => void;
} {
  const config = store.useConfig()();
  const clusterConfig = cluster ? config?.clusters?.[cluster] : undefined;
  const localForwards = clusterConfig?.persistentForwards;
  const [shared, setShared] = React.useState<SharedForwardsResult | null>(null);
  const [reloadCount, setReloadCount] = React.useState(0);

  /** Re-reads the shared source now, for callers that just wrote to it. */
  const reloadShared = React.useCallback(() => setReloadCount(count => count + 1), []);

  // Keyed on the resolved source rather than the whole config, so toggling a
  // switch does not re-read the cluster.
  const sourceKey = JSON.stringify([clusterConfig?.sharedConfigMap ?? null, cluster]);

  React.useEffect(() => {
    if (!cluster) {
      setShared(null);
      return;
    }

    let cancelled = false;
    loadSharedForwards(cluster, clusterConfig).then(result => {
      if (cancelled) {
        return;
      }
      // A failed refresh keeps the entries we already had. Replacing them with
      // an empty list made every shared forward look unconfigured - names gone,
      // auto-start unavailable - until the next successful read. The status is
      // still recorded so the settings page can report the failure.
      setShared(previous =>
        (result.error || result.missing) && previous?.forwards.length
          ? { ...result, forwards: previous.forwards }
          : result
      );
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, reloadCount]);

  React.useEffect(() => {
    if (!cluster) {
      return;
    }
    const interval = setInterval(reloadShared, SHARED_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [cluster, reloadShared]);

  return React.useMemo(() => {
    const index = buildForwardIndex(localForwards, shared?.forwards);
    return { ...index, sharedStatus: shared, reloadShared };
  }, [localForwards, shared, reloadShared]);
}
