import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { buildForwardIndex, flattenForwardIndex } from '../forwards';
import { loadSharedForwards } from '../sharedConfigMap';
import { store } from '../store';
import { resolvePodForService } from '../utils';

/**
 * Starts the forwards that opted into auto-start when entering a cluster.
 *
 * Counting is deliberately not done here: the app bar takes its numbers from
 * usePortForwardList so they cannot disagree with the list itself.
 *
 * @returns settling - true until the first auto-start pass for this cluster
 *   finished, so callers can show progress instead of a count that is about to
 *   change anyway.
 */
export function usePortForwardLogic() {
  const config = store.useConfig()();
  const currentCluster = K8s.useCluster();
  // Tracks the cluster whose first pass is done, rather than a plain boolean:
  // the effect also re-runs whenever the config changes, and those later passes
  // must not flash the app bar back into a loading state.
  const [settledCluster, setSettledCluster] = useState<string | null>(null);
  const { enqueueSnackbar } = useSnackbar();

  useEffect(() => {
    if (!currentCluster) {
      return;
    }

    // Cluster comes in as a parameter rather than off the closure: the null
    // check above does not narrow a captured variable inside a hoisted function
    // declaration, so reading it here would still be string | null.
    async function setupPortForwards(cluster: string) {
      const clusterConfig = config?.clusters?.[cluster];
      const shared = await loadSharedForwards(cluster, clusterConfig);

      // Ids come off the same index the list builds, so the forwards we create
      // are the ones the list recognises - and two configured entries that only
      // differ in local port get distinct ids instead of one overwriting the
      // other.
      const configured = flattenForwardIndex(
        buildForwardIndex(clusterConfig?.persistentForwards, shared.forwards)
      );

      // Auto-start is opt-in: everything else is only registered, and shows up
      // in the port forwards list as stopped for the user to start manually.
      const toStart = configured.filter(({ entry }) => entry.autoStart === true);

      // Reported even when nothing was due to auto-start: a shared source that
      // cannot be read used to be indistinguishable from an empty one.
      const failures: string[] = [];
      if (shared.error) {
        failures.push(shared.error);
      } else if (shared.missing) {
        // 404 carries no error message, so this used to pass silently and the
        // shared forwards simply never appeared.
        failures.push('the shared ConfigMap does not exist yet');
      }

      if (toStart.length > 0) {
        try {
          const existingForwards = await ApiProxy.listPortForward(cluster);
          const existingIds = new Set(existingForwards.map(pf => pf.id));

          for (const { id: pfId, entry: portInfo } of toStart) {
            if (existingIds.has(pfId)) {
              console.info('Skipping existing port forward: ', pfId);
              continue;
            }

            const label = portInfo.name || portInfo.service || portInfo.pod || pfId;
            let podName = portInfo.pod;

            // If pod name is not provided, resolve it from the service
            if (!podName && portInfo.service) {
              podName = await resolvePodForService(cluster, portInfo.namespace, portInfo.service);
              if (podName) {
                console.log(`Resolved pod ${podName} for service ${portInfo.service}`);
              }
            }

            if (!podName) {
              failures.push(`${label}: no running pod found`);
              continue;
            }

            try {
              await ApiProxy.startPortForward(
                cluster,
                portInfo.namespace,
                podName,
                portInfo.targetPort.toString(),
                portInfo.service,
                portInfo.namespace,
                portInfo.localPort.toString(),
                undefined,
                pfId
              );
              console.log(`Started port forward: ${pfId} on pod ${podName}`);
            } catch (err) {
              failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }

      // Auto-start used to fail into the console only, so a forward the user
      // deliberately opted in to simply was not there, with no explanation.
      if (failures.length > 0) {
        console.error('Auto-start failures:', failures);
        enqueueSnackbar(`Could not auto-start: ${failures.join('; ')}`, {
          key: 'portforward-autostart-error',
          preventDuplicate: true,
          variant: 'warning',
        });
      }
    }

    let cancelled = false;

    setupPortForwards(currentCluster).finally(() => {
      if (!cancelled) {
        setSettledCluster(currentCluster);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentCluster, config, enqueueSnackbar]);

  return {
    currentCluster,
    settling: !!currentCluster && settledCluster !== currentCluster,
  };
}
