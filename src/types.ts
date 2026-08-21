export interface SharedPortForward {
  id?: string;
  name: string;
  namespace: string;
  service: string;
  pod?: string; // Optional, will be resolved from service if missing
  localPort: number | string;
  targetPort: number | string;
  serviceNamespace?: string;
  /**
   * Start this forward automatically when entering the cluster.
   *
   * Opt-in: anything other than true means the forward is only registered,
   * shown in the list as stopped, and started manually.
   */
  autoStart?: boolean;
}

/** Where a cluster's shared forwards are defined, when in-cluster. */
export interface SharedConfigMapRef {
  namespace: string;
  name: string;
}

export interface ClusterSettings {
  /**
   * In-cluster source of the shared forwards: no external hosting, read through
   * the same authenticated path as everything else, and not subject to CORS.
   */
  sharedConfigMap?: SharedConfigMapRef;
  persistentForwards?: SharedPortForward[];
}

/** Outcome of resolving a cluster's shared forwards. */
export interface SharedForwardsResult {
  forwards: SharedPortForward[];
  /** Human-readable reason the source could not be read. */
  error?: string;
  /** The configured source does not exist yet. */
  missing?: boolean;
  /** The user may not read the configured source. */
  forbidden?: boolean;
}

export interface PluginSettingsData {
  clusters?: {
    [clusterName: string]: ClusterSettings;
  };
}
/**
 * A port forward as reported by the Headlamp backend, or restored from
 * localStorage (in which case its status is "Stopped").
 *
 * Mirrors the PortForward interface of
 * @kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/portForward.
 */
export interface PortForwardEntry {
  id: string;
  pod: string;
  service: string;
  serviceNamespace: string;
  namespace: string;
  cluster: string;
  port: string;
  targetPort: string;
  status?: string;
  error?: string;
}

/**
 * The forwards configured for a cluster, indexed by the id they get at runtime.
 *
 * Local ones are owned by the plugin settings; external ones come from the
 * shared ports URL and can only be changed in that JSON.
 */
export interface ConfiguredForwards {
  local: Map<string, SharedPortForward>;
  external: Map<string, SharedPortForward>;
}

/**
 * A list row with everything the cells need already resolved.
 *
 * Cells used to look their configuration up themselves from a shared object
 * held in a closure, and two cells in the same row could disagree about the
 * same forward - one showing it as shared while another showed it as
 * unconfigured. Resolving once per row and rendering purely from row data makes
 * that impossible.
 */
export interface ListRow extends PortForwardEntry {
  /** Where the forward is configured, if anywhere. */
  configuredSource?: 'local' | 'external';
  configuredEntry?: SharedPortForward;
  /** User-given name, when it adds anything over the resource name. */
  label?: string;
  autoStart: boolean;
  running: boolean;
  /**
   * Identity for the table, covering every field the cells render from.
   *
   * The table caches rows by the id it is given, and reuses the cached row -
   * and its cells - when the id is unchanged. Keying on the forward id alone
   * meant a row that gained configuration without changing status kept its
   * stale cells: the auto-start toggle stayed a dash until the forward was
   * started, which changed the status and forced a rebuild.
   */
  renderKey: string;
}
