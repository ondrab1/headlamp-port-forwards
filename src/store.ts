import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';
import { PluginSettingsData, PortForwardEntry, SharedPortForward } from './types';

export const PLUGIN_NAME = 'persistent-port-forwards';
export const store = new ConfigStore<PluginSettingsData>(PLUGIN_NAME);

/** Whether the given port forward id is saved as persistent for the cluster. */
export function isPersisted(
  config: PluginSettingsData | null | undefined,
  cluster: string,
  id: string
): boolean {
  return !!config?.clusters?.[cluster]?.persistentForwards?.some(
    (pf: SharedPortForward) => pf.id === id
  );
}

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

/** Saves a port forward so it gets re-created on every app start. */
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
    current.some(item => item.id === entry.id) ? current : [...current, entry]
  );
}

/** Removes a previously persisted port forward. */
export function removePersistentForward(cluster: string, id: string | undefined) {
  withPersistentForwards(cluster, current => current.filter(item => item.id !== id));
}

/** Renames a persisted port forward. */
export function setPersistentName(cluster: string, id: string | undefined, name: string) {
  withPersistentForwards(cluster, current =>
    current.map(item => (item.id === id ? { ...item, name } : item))
  );
}

/** Turns auto-start on or off for a persisted port forward. */
export function setAutoStart(cluster: string, id: string | undefined, autoStart: boolean) {
  withPersistentForwards(cluster, current =>
    current.map(item => (item.id === id ? { ...item, autoStart } : item))
  );
}
