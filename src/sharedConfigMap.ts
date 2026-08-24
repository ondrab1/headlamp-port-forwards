import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  ClusterSettings,
  SharedConfigMapRef,
  SharedForwardsResult,
  SharedPortForward,
} from './types';
import { describeError } from './utils';

/** Suggested location, offered as the default in the settings. */
export const DEFAULT_SHARED_CONFIG_MAP: SharedConfigMapRef = {
  namespace: 'headlamp',
  name: 'shared-port-forwards',
};

/** The ConfigMap key holding the forward definitions. */
export const SHARED_DATA_KEY = 'port-forwards.json';

type KubeConfigMap = K8s.configMap.KubeConfigMap;

function statusOf(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as { status?: number }).status : undefined;
}

/** Reads a ConfigMap through Headlamp's authenticated cluster proxy. */
export function getConfigMap(
  cluster: string,
  namespace: string,
  name: string
): Promise<KubeConfigMap> {
  return new Promise((resolve, reject) => {
    (K8s.ResourceClasses.ConfigMap.apiEndpoint as any).get(
      namespace,
      name,
      (configMap: KubeConfigMap) => resolve(configMap),
      (err: any) => reject(err),
      undefined,
      cluster
    );
  });
}

/**
 * Parses the forward definitions out of a ConfigMap.
 *
 * Accepts the documented key, and falls back to the only key present so a
 * ConfigMap created by hand under a different key still works.
 */
export function parseSharedConfigMap(configMap: KubeConfigMap): SharedPortForward[] {
  const data = configMap?.data || {};
  const keys = Object.keys(data);
  const raw = data[SHARED_DATA_KEY] ?? (keys.length === 1 ? data[keys[0]] : undefined);

  if (!raw) {
    throw new Error(`ConfigMap has no "${SHARED_DATA_KEY}" key`);
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`"${SHARED_DATA_KEY}" is not a JSON array`);
  }

  return parsed as SharedPortForward[];
}

/** The body to create the ConfigMap with. Partial by design: the API server
 * fills in the rest of the metadata. */
export function buildSharedConfigMap(ref: SharedConfigMapRef, forwards: SharedPortForward[]) {
  return {
    kind: 'ConfigMap',
    apiVersion: 'v1',
    metadata: {
      name: ref.name,
      namespace: ref.namespace,
    },
    data: {
      [SHARED_DATA_KEY]: `${JSON.stringify(forwards, null, 2)}\n`,
    },
  };
}

/**
 * Manifest to hand to whoever does have write access.
 *
 * @param includeNamespace - prepend a Namespace document, so a user without
 *   rights to create either one still gets something appliable in one go.
 */
export function buildSharedConfigMapYaml(
  ref: SharedConfigMapRef,
  forwards: SharedPortForward[],
  includeNamespace = false
): string {
  const json = `${JSON.stringify(forwards, null, 2)}\n`;
  const indented = json
    .split('\n')
    .map(line => (line ? `    ${line}` : line))
    .join('\n')
    .replace(/\n+$/, '');

  const namespaceDoc = includeNamespace
    ? ['apiVersion: v1', 'kind: Namespace', 'metadata:', `  name: ${ref.namespace}`, '---']
    : [];

  return [
    ...namespaceDoc,
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: ${ref.name}`,
    `  namespace: ${ref.namespace}`,
    'data:',
    `  ${SHARED_DATA_KEY}: |`,
    indented,
    '',
  ].join('\n');
}

/** Whether the namespace the ConfigMap would live in already exists. */
export async function namespaceExists(cluster: string, namespace: string): Promise<boolean> {
  try {
    await new Promise((resolve, reject) => {
      (K8s.ResourceClasses.Namespace.apiEndpoint as any).get(
        namespace,
        resolve,
        reject,
        undefined,
        cluster
      );
    });
    return true;
  } catch (err) {
    if (statusOf(err) === 404) {
      return false;
    }
    // Anything else (typically 403) is not a definite "missing"; let the
    // ConfigMap request produce the real error instead of guessing here.
    return true;
  }
}

function createNamespace(cluster: string, namespace: string): Promise<unknown> {
  return (K8s.ResourceClasses.Namespace.apiEndpoint as any).post(
    { kind: 'Namespace', apiVersion: 'v1', metadata: { name: namespace } },
    undefined,
    cluster
  );
}

/**
 * Creates the shared ConfigMap, and its namespace when that is missing too.
 *
 * Creating the namespace is part of the same click on purpose: a dedicated
 * namespace usually does not exist yet, and failing with "namespaces not found"
 * left the user to go create it by hand - exactly the manual step the Create
 * button exists to avoid. The button label says when a namespace will be
 * created, so a cluster-scoped resource never appears unannounced.
 */
export async function createSharedConfigMap(
  cluster: string,
  ref: SharedConfigMapRef,
  forwards: SharedPortForward[]
): Promise<unknown> {
  if (!(await namespaceExists(cluster, ref.namespace))) {
    await createNamespace(cluster, ref.namespace);
  }

  return (K8s.ResourceClasses.ConfigMap.apiEndpoint as any).post(
    buildSharedConfigMap(ref, forwards),
    undefined,
    cluster
  );
}

/**
 * The forwards in a ConfigMap, treating a missing key as an empty list.
 *
 * Used by the write path: bootstrapping onto a ConfigMap that has no key yet is
 * fine, but a malformed list must stop the write rather than be overwritten.
 */
function readForWrite(configMap: KubeConfigMap): SharedPortForward[] {
  const data = configMap?.data || {};
  if (!(SHARED_DATA_KEY in data) && Object.keys(data).length === 0) {
    return [];
  }
  return parseSharedConfigMap(configMap);
}

/**
 * Identity of an entry for merging purposes.
 *
 * Deliberately not getBaseForwardId: that one omits the local port, and
 * buildForwardIndex treats entries differing only in local port as distinct
 * (it suffixes the colliding one). Merging on the base id would silently
 * replace one of a pair the list is perfectly happy to show side by side.
 * Order-independent, unlike the index's first-come numbering.
 */
function sharedForwardKey(pf: SharedPortForward): string {
  return pf.id || `${pf.namespace}-${pf.service}-${pf.targetPort}-${pf.localPort}`;
}

/**
 * Adds a forward to a list, replacing any entry with the same identity.
 *
 * Pure so the merge can be tested without a cluster.
 */
export function mergeSharedForward(
  existing: SharedPortForward[],
  entry: SharedPortForward
): SharedPortForward[] {
  const key = sharedForwardKey(entry);
  return [...existing.filter(pf => sharedForwardKey(pf) !== key), entry];
}

/**
 * Renames the entry with the given identity.
 *
 * Pure so the rewrite can be tested without a cluster.
 */
export function renameSharedForwardIn(
  existing: SharedPortForward[],
  key: string,
  name: string
): SharedPortForward[] {
  return existing.map(pf => (sharedForwardKey(pf) === key ? { ...pf, name } : pf));
}

/** The identity used to locate an entry inside the shared ConfigMap. */
export function sharedForwardIdentity(pf: SharedPortForward): string {
  return sharedForwardKey(pf);
}

/** Turns auto-start on or off for an entry in the shared ConfigMap. */
export async function setSharedAutoStart(
  cluster: string,
  ref: SharedConfigMapRef,
  entry: SharedPortForward,
  autoStart: boolean
): Promise<unknown> {
  const current = await getConfigMap(cluster, ref.namespace, ref.name);
  const key = sharedForwardKey(entry);
  const updatedList = readForWrite(current).map(pf =>
    sharedForwardKey(pf) === key ? { ...pf, autoStart } : pf
  );

  const updated: KubeConfigMap = {
    ...current,
    data: {
      ...(current.data || {}),
      [SHARED_DATA_KEY]: `${JSON.stringify(updatedList, null, 2)}\n`,
    },
  };

  return (K8s.ResourceClasses.ConfigMap.apiEndpoint as any).put(updated, undefined, cluster);
}

/**
 * Renames a forward in the shared ConfigMap.
 *
 * Reads first for the same reason as adding: the caller only has the last poll,
 * and writing that back would drop concurrent changes.
 */
export async function renameSharedForward(
  cluster: string,
  ref: SharedConfigMapRef,
  entry: SharedPortForward,
  name: string
): Promise<unknown> {
  const current = await getConfigMap(cluster, ref.namespace, ref.name);
  const renamed = renameSharedForwardIn(readForWrite(current), sharedForwardKey(entry), name);

  const updated: KubeConfigMap = {
    ...current,
    data: {
      ...(current.data || {}),
      [SHARED_DATA_KEY]: `${JSON.stringify(renamed, null, 2)}\n`,
    },
  };

  return (K8s.ResourceClasses.ConfigMap.apiEndpoint as any).put(updated, undefined, cluster);
}

/**
 * Adds a forward to the shared ConfigMap.
 *
 * The existing list is read here rather than taken from the caller: the caller
 * only has whatever the last poll returned, and writing that back would drop
 * entries a colleague added in the meantime. The resourceVersion from this read
 * travels with the update, so a genuinely concurrent write fails loudly.
 */
export async function addSharedForward(
  cluster: string,
  ref: SharedConfigMapRef,
  entry: SharedPortForward
): Promise<unknown> {
  const current = await getConfigMap(cluster, ref.namespace, ref.name);
  const merged = mergeSharedForward(readForWrite(current), entry);

  const updated: KubeConfigMap = {
    ...current,
    data: {
      ...(current.data || {}),
      [SHARED_DATA_KEY]: `${JSON.stringify(merged, null, 2)}\n`,
    },
  };

  return (K8s.ResourceClasses.ConfigMap.apiEndpoint as any).put(updated, undefined, cluster);
}

/**
 * Resolves a cluster's shared forwards from its ConfigMap.
 *
 * Failures are reported rather than swallowed: an unreadable source used to look
 * exactly like an empty one, which left no way to tell a typo from "nothing
 * shared yet".
 */
export async function loadSharedForwards(
  cluster: string,
  clusterConfig: ClusterSettings | undefined
): Promise<SharedForwardsResult> {
  const ref = clusterConfig?.sharedConfigMap;

  if (ref?.namespace && ref?.name) {
    try {
      return {
        forwards: parseSharedConfigMap(await getConfigMap(cluster, ref.namespace, ref.name)),
      };
    } catch (err) {
      const status = statusOf(err);
      if (status === 404) {
        return { forwards: [], missing: true };
      }
      if (status === 403 || status === 401) {
        return {
          forwards: [],
          forbidden: true,
          error: `Not allowed to read ConfigMap ${ref.namespace}/${ref.name}`,
        };
      }
      return {
        forwards: [],
        error: `Could not read ConfigMap ${ref.namespace}/${ref.name}: ${describeError(err)}`,
      };
    }
  }

  return { forwards: [] };
}
