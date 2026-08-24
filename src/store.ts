import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';
import { sameForward } from './forwards';
import { PluginSettingsData, PortForwardEntry, SharedPortForward } from './types';

export const PLUGIN_NAME = 'persistent-port-forwards';
export const store = new ConfigStore<PluginSettingsData>(PLUGIN_NAME);

function withPersistentForwards(
  cluster: string,
  update: (current: SharedPortForward[]) => SharedPortForward[]
) {
  const currentConfig = store.get() || {};
  const clusterConfig = currentConfig.clusters?.[cluster] || {};

  const newConfig: PluginSettingsData = {
    ...currentConfig,
    clusters: {
      ...(currentConfig.clusters || {}),
      [cluster]: {
        ...clusterConfig,
        persistentForwards: update(clusterConfig.persistentForwards || []),
      },
    },
  };

  store.set(newConfig);
}

/**
 * Saves a port forward so it gets re-created on every app start.
 *
 * Already-saved is decided on the target: the same forward re-created from a
 * resource page comes back with a new backend id, and comparing ids would store
 * a second entry for it and list it twice.
 */
export function addPersistentForward(cluster: string, pf: PortForwardEntry) {
  const entry: SharedPortForward = {
    id: pf.id,
    name: pf.service || pf.pod || pf.id,
    namespace: pf.namespace,
    pod: pf.pod,
    service: pf.service,
    serviceNamespace: pf.serviceNamespace,
    targetPort: pf.targetPort,
    localPort: pf.port,
  };

  withPersistentForwards(cluster, current =>
    current.some(item => sameForward(item, entry)) ? current : [...current, entry]
  );
}

/**
 * Removes a previously persisted port forward.
 *
 * Takes the stored entry rather than a row id. The two differ whenever the
 * forward was matched to its entry by target - the usual case once a forward
 * has been re-created - and passing the row id then quietly removed nothing.
 */
export function removePersistentForward(cluster: string, entry: SharedPortForward) {
  withPersistentForwards(cluster, current => current.filter(item => !sameForward(item, entry)));
}

/** Renames a persisted port forward. */
export function setPersistentName(cluster: string, entry: SharedPortForward, name: string) {
  withPersistentForwards(cluster, current =>
    current.map(item => (sameForward(item, entry) ? { ...item, name } : item))
  );
}

/** Turns auto-start on or off for a persisted port forward. */
export function setAutoStart(cluster: string, entry: SharedPortForward, autoStart: boolean) {
  withPersistentForwards(cluster, current =>
    current.map(item => (sameForward(item, entry) ? { ...item, autoStart } : item))
  );
}
