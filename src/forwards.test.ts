import { describe, expect, it, vi } from 'vitest';

// The real module pulls in the whole Headlamp component library; only the two
// status constants matter here and they are plain strings upstream.
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  PORT_FORWARD_RUNNING_STATUS: 'Running',
  PORT_FORWARD_STOP_STATUS: 'Stopped',
}));

import {
  buildForwardIndex,
  compareForwards,
  decorateRows,
  findConfigured,
  flattenForwardIndex,
  getBaseForwardId,
  getForwardLabel,
  isRunning,
  isStopped,
  mergeStoredForwards,
  sameForward,
  synthesizeMissingRows,
} from './forwards';

type Entry = Parameters<typeof isRunning>[0];

function row(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'id-1',
    pod: 'pod-1',
    service: 'svc-1',
    serviceNamespace: 'ns',
    namespace: 'ns',
    cluster: 'c1',
    port: '8080',
    targetPort: '80',
    status: 'Running',
    error: '',
    ...overrides,
  };
}

describe('getBaseForwardId', () => {
  it('prefers an explicit id', () => {
    expect(
      getBaseForwardId({
        id: 'explicit',
        name: 'n',
        namespace: 'ns',
        service: 's',
        localPort: 1,
        targetPort: 2,
      })
    ).toBe('explicit');
  });

  it('derives one from namespace, service and target port', () => {
    expect(
      getBaseForwardId({
        name: 'n',
        namespace: 'ns',
        service: 'svc',
        localPort: 1,
        targetPort: 443,
      })
    ).toBe('ns-svc-443');
  });
});

describe('buildForwardIndex', () => {
  it('keeps entries that share a derived id apart', () => {
    // Regression: these collapsed into one map slot, so one forward silently
    // vanished from the list and never started.
    const external = [
      { name: 'direct', namespace: 'ns', service: 'wg', localPort: 1433, targetPort: 1433 },
      { name: 'alt', namespace: 'ns', service: 'wg', localPort: 11433, targetPort: 1433 },
    ];

    const index = buildForwardIndex(undefined, external);

    expect(index.external.size).toBe(2);
    expect([...index.external.values()].map(e => e.name).sort()).toEqual(['alt', 'direct']);
  });

  it('leaves the first occurrence on its plain id so nothing needs migrating', () => {
    const external = [
      { name: 'first', namespace: 'ns', service: 'wg', localPort: 1433, targetPort: 1433 },
      { name: 'second', namespace: 'ns', service: 'wg', localPort: 11433, targetPort: 1433 },
    ];

    const index = buildForwardIndex(undefined, external);

    expect(index.external.get('ns-wg-1433')?.name).toBe('first');
    expect(index.external.get('ns-wg-1433-11433')?.name).toBe('second');
  });

  it('claims local ids before external ones', () => {
    const shared = { namespace: 'ns', service: 'wg', targetPort: 1433 };
    const index = buildForwardIndex(
      [{ ...shared, name: 'local', localPort: 1433 }],
      [{ ...shared, name: 'external', localPort: 9999 }]
    );

    expect(index.local.get('ns-wg-1433')?.name).toBe('local');
    expect(index.external.get('ns-wg-1433-9999')?.name).toBe('external');
  });

  it('survives three-way collisions', () => {
    const base = { namespace: 'ns', service: 'wg', targetPort: 1433, localPort: 1433 };
    const index = buildForwardIndex(undefined, [
      { ...base, name: 'a' },
      { ...base, name: 'b' },
      { ...base, name: 'c' },
    ]);

    expect(index.external.size).toBe(3);
    expect(new Set(index.external.keys()).size).toBe(3);
  });

  it('handles missing input', () => {
    const index = buildForwardIndex(undefined, undefined);
    expect(index.local.size).toBe(0);
    expect(index.external.size).toBe(0);
  });
});

describe('flattenForwardIndex', () => {
  it('reports the id each entry was indexed under, with its source', () => {
    const index = buildForwardIndex(
      [{ id: 'l1', name: 'local', namespace: 'ns', service: 's', localPort: 1, targetPort: 2 }],
      [{ id: 'e1', name: 'ext', namespace: 'ns', service: 's', localPort: 3, targetPort: 4 }]
    );

    expect(flattenForwardIndex(index)).toEqual([
      { id: 'l1', entry: expect.objectContaining({ name: 'local' }), source: 'local' },
      { id: 'e1', entry: expect.objectContaining({ name: 'ext' }), source: 'external' },
    ]);
  });
});

describe('findConfigured', () => {
  const index = buildForwardIndex(
    [{ id: 'l1', name: 'local', namespace: 'ns', service: 's', localPort: 1, targetPort: 2 }],
    [{ id: 'e1', name: 'ext', namespace: 'ns', service: 's', localPort: 3, targetPort: 4 }]
  );

  it('finds local entries', () => {
    expect(findConfigured(index, row({ id: 'l1' }))?.source).toBe('local');
  });

  it('finds external entries', () => {
    expect(findConfigured(index, row({ id: 'e1' }))?.source).toBe('external');
  });

  it('returns undefined for forwards that are not configured', () => {
    expect(
      findConfigured(index, row({ id: 'nope', service: 'other', namespace: 'other' }))
    ).toBeUndefined();
  });
});

describe('isRunning / isStopped', () => {
  it('treats a running forward as running', () => {
    expect(isRunning(row({ status: 'Running' }))).toBe(true);
    expect(isStopped(row({ status: 'Running' }))).toBe(false);
  });

  it('treats a stopped forward as stopped', () => {
    expect(isRunning(row({ status: 'Stopped' }))).toBe(false);
    expect(isStopped(row({ status: 'Stopped' }))).toBe(true);
  });

  it('keeps a stopped forward resumable despite a stale error', () => {
    // Regression: both predicates excluded errored rows, so such a row had no
    // primary action and was skipped by bulk resume.
    const errored = row({ status: 'Stopped', error: 'pod is not running' });
    expect(isStopped(errored)).toBe(true);
    expect(isRunning(errored)).toBe(false);
  });

  it('never leaves a row in neither state', () => {
    const states = ['Running', 'Stopped', 'Error', '', undefined];
    for (const status of states) {
      for (const error of ['', 'boom']) {
        const pf = row({ status, error });
        expect(isRunning(pf)).not.toBe(isStopped(pf));
      }
    }
  });
});

describe('compareForwards', () => {
  it('is stable no matter how the backend orders its map', () => {
    // Regression: /portforward/list comes out of a Go map, so its order is
    // randomised on every poll and the rows visibly reshuffled.
    const rows = [
      row({ id: 'b', service: 'wg', port: '8443' }),
      row({ id: 'a', service: 'wg', port: '1433' }),
      row({ id: 'c', service: 'apache', port: '80' }),
    ];

    const orders = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const shuffled = [...rows].sort(() => Math.random() - 0.5);
      orders.add(
        shuffled
          .sort(compareForwards)
          .map(r => r.id)
          .join(',')
      );
    }

    expect(orders.size).toBe(1);
    expect([...orders][0]).toBe('c,a,b');
  });

  it('orders by port within the same resource', () => {
    const low = row({ id: 'x', service: 'wg', port: '1433' });
    const high = row({ id: 'y', service: 'wg', port: '8443' });
    expect(compareForwards(low, high)).toBeLessThan(0);
  });

  it('falls back to the id so the order is total', () => {
    const a = row({ id: 'a', service: 'wg', port: '80' });
    const b = row({ id: 'b', service: 'wg', port: '80' });
    expect(compareForwards(a, b)).toBeLessThan(0);
    expect(compareForwards(a, a)).toBe(0);
  });

  it('sorts pod-only forwards by pod name', () => {
    const a = row({ id: '1', service: '', pod: 'alpha' });
    const b = row({ id: '2', service: '', pod: 'beta' });
    expect(compareForwards(a, b)).toBeLessThan(0);
  });
});

describe('synthesizeMissingRows', () => {
  const index = buildForwardIndex(
    [
      {
        id: 'never-started',
        name: 'Redis',
        namespace: 'cache',
        service: 'redis',
        localPort: 6379,
        targetPort: 6379,
      },
    ],
    undefined
  );

  it('makes a configured forward that never ran visible and stopped', () => {
    const rows = synthesizeMissingRows(index, [], 'c1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'never-started',
      cluster: 'c1',
      namespace: 'cache',
      service: 'redis',
      port: '6379',
      targetPort: '6379',
      status: 'Stopped',
    });
  });

  it('does not duplicate a forward that is already known', () => {
    expect(synthesizeMissingRows(index, [row({ id: 'never-started' })], 'c1')).toEqual([]);
  });

  it('produces nothing without a cluster', () => {
    expect(synthesizeMissingRows(index, [], '')).toEqual([]);
  });

  it('defaults the service namespace to the namespace', () => {
    const rows = synthesizeMissingRows(index, [], 'c1');
    expect(rows[0].serviceNamespace).toBe('cache');
  });
});

describe('getForwardLabel', () => {
  function indexWithName(name: string, id = 'id-1') {
    return buildForwardIndex(
      [{ id, name, namespace: 'ns', service: 'svc-1', localPort: 1, targetPort: 2 }],
      undefined
    );
  }

  it('shows a name that adds information', () => {
    expect(getForwardLabel(row(), indexWithName('ZNZ MSSQL Database'))).toBe('ZNZ MSSQL Database');
  });

  it('hides a name that just repeats the service', () => {
    expect(getForwardLabel(row(), indexWithName('svc-1'))).toBeUndefined();
  });

  it('hides a name that just repeats the pod', () => {
    expect(getForwardLabel(row({ service: '' }), indexWithName('pod-1'))).toBeUndefined();
  });

  it('hides a name that is only the id', () => {
    // Older versions stored the raw id as the name, which is a UUID for
    // manually created forwards.
    expect(getForwardLabel(row(), indexWithName('id-1'))).toBeUndefined();
  });

  it('returns undefined for forwards that are not configured', () => {
    expect(getForwardLabel(row({ id: 'other' }), indexWithName('Something'))).toBeUndefined();
  });

  it('ignores surrounding whitespace', () => {
    expect(getForwardLabel(row(), indexWithName('  svc-1  '))).toBeUndefined();
  });
});

describe('findConfigured against real shared data', () => {
  // Verbatim from the cluster's shared-port-forwards ConfigMap: local and
  // target ports arrive as strings there.
  const external = [
    {
      name: 'ZNZ SQL Server',
      namespace: 'wpjshop-prod-fragranza',
      service: 'wg-tunnel',
      localPort: '1433',
      targetPort: '1433',
      autoStart: false,
    },
    {
      name: 'RabbitMQ Management',
      namespace: 'rabbitmq',
      service: 'rabbitmq-cluster',
      localPort: '15672',
      targetPort: '15672',
      autoStart: false,
    },
  ];
  const index = buildForwardIndex(undefined, external);

  // Verbatim from localStorage.
  const znzRow = row({
    id: 'wpjshop-prod-fragranza-wg-tunnel-1433',
    namespace: 'wpjshop-prod-fragranza',
    serviceNamespace: 'wpjshop-prod-fragranza',
    service: 'wg-tunnel',
    pod: '',
    targetPort: '1433',
    port: '1433',
  });
  const rabbitRow = row({
    id: 'rabbitmq-rabbitmq-cluster-15672',
    namespace: 'rabbitmq',
    serviceNamespace: 'rabbitmq',
    service: 'rabbitmq-cluster',
    pod: 'rabbitmq-cluster-server-0',
    targetPort: '15672',
    port: '15672',
  });

  it('matches both shared forwards', () => {
    expect(findConfigured(index, znzRow)?.entry.name).toBe('ZNZ SQL Server');
    expect(findConfigured(index, rabbitRow)?.entry.name).toBe('RabbitMQ Management');
  });

  it('reports them as external, so they are not offered for sharing again', () => {
    expect(findConfigured(index, znzRow)?.source).toBe('external');
    expect(findConfigured(index, rabbitRow)?.source).toBe('external');
  });

  it('still matches when the id does not line up at all', () => {
    // The failure we could not otherwise explain: same forward, different id.
    const withUuid = { ...rabbitRow, id: 'd2743aa9-0136-4de1-92d4-749aa762ad17' };
    expect(findConfigured(index, withUuid)?.entry.name).toBe('RabbitMQ Management');
  });

  it('does not match a different local port', () => {
    const otherPort = { ...rabbitRow, id: 'x', port: '56051' };
    expect(findConfigured(index, otherPort)).toBeUndefined();
  });

  it('surfaces the shared name as the row label', () => {
    expect(getForwardLabel(rabbitRow, index)).toBe('RabbitMQ Management');
  });
});

describe('decorateRows', () => {
  const external = [
    {
      name: 'RabbitMQ Management',
      namespace: 'rabbitmq',
      service: 'rabbitmq-cluster',
      localPort: '15672',
      targetPort: '15672',
      autoStart: false,
    },
  ];
  const index = buildForwardIndex(undefined, external);
  const rabbitRow = row({
    id: 'rabbitmq-rabbitmq-cluster-15672',
    namespace: 'rabbitmq',
    serviceNamespace: 'rabbitmq',
    service: 'rabbitmq-cluster',
    targetPort: '15672',
    port: '15672',
    status: 'Running',
  });

  it('resolves the source, name, auto-start and running state together', () => {
    const [decorated] = decorateRows([rabbitRow], index);

    expect(decorated).toMatchObject({
      configuredSource: 'external',
      label: 'RabbitMQ Management',
      autoStart: false,
      running: true,
    });
  });

  it('never lets two cells disagree about one forward', () => {
    // The bug this exists to prevent: the Persistent column showed the forward
    // as shared while Auto-start showed it as configured nowhere, because each
    // cell resolved it separately. One resolution per row makes that
    // impossible, so assert the fields cannot contradict each other.
    const rows = decorateRows([rabbitRow, row({ id: 'unconfigured' })], index);

    rows.forEach(decorated => {
      const isConfigured = !!decorated.configuredSource;
      expect(!!decorated.configuredEntry).toBe(isConfigured);
      if (!isConfigured) {
        expect(decorated.autoStart).toBe(false);
        expect(decorated.label).toBeUndefined();
      }
    });
  });

  it('marks the forwards whose action is still in flight', () => {
    const rows = decorateRows([rabbitRow, row({ id: 'other' })], index, [rabbitRow.id]);

    expect(rows[0].pending).toBe(true);
    expect(rows[1].pending).toBe(false);
  });

  it('marks a stopped forward as not running', () => {
    const [decorated] = decorateRows([{ ...rabbitRow, status: 'Stopped' }], index);
    expect(decorated.running).toBe(false);
    expect(decorated.configuredSource).toBe('external');
  });
});

describe('renderKey', () => {
  const entry = {
    name: 'RabbitMQ Management',
    namespace: 'rabbitmq',
    service: 'rabbitmq-cluster',
    localPort: '15672',
    targetPort: '15672',
    autoStart: false,
  };
  const configured = buildForwardIndex(undefined, [entry]);
  const empty = buildForwardIndex(undefined, undefined);
  const stopped = row({
    id: 'rabbitmq-rabbitmq-cluster-15672',
    namespace: 'rabbitmq',
    serviceNamespace: 'rabbitmq',
    service: 'rabbitmq-cluster',
    targetPort: '15672',
    port: '15672',
    status: 'Stopped',
  });

  function keyOf(pf: typeof stopped, index: typeof configured, pendingIds: string[] = []) {
    return decorateRows([pf], index, pendingIds)[0].renderKey;
  }

  it('changes when configuration arrives, even though the status did not', () => {
    // The shared ConfigMap loads asynchronously, so a stopped row is first
    // rendered as unconfigured. Keyed on id and status alone the table kept the
    // stale cells and the auto-start toggle never appeared.
    expect(keyOf(stopped, empty)).not.toBe(keyOf(stopped, configured));
  });

  it('changes when the forward starts', () => {
    expect(keyOf(stopped, configured)).not.toBe(
      keyOf({ ...stopped, status: 'Running' }, configured)
    );
  });

  it('changes when auto-start is toggled', () => {
    const enabled = buildForwardIndex(undefined, [{ ...entry, autoStart: true }]);
    expect(keyOf(stopped, configured)).not.toBe(keyOf(stopped, enabled));
  });

  it('changes when the name changes', () => {
    const renamed = buildForwardIndex(undefined, [{ ...entry, name: 'Rabbit UI' }]);
    expect(keyOf(stopped, configured)).not.toBe(keyOf(stopped, renamed));
  });

  it('changes the moment the forward is marked pending', () => {
    // Starting takes a second or two. Without the pending flag in the key the
    // table reused the cached cells, so the spinner only appeared once the poll
    // brought a new status - and the click looked like it did nothing.
    expect(keyOf(stopped, configured)).not.toBe(keyOf(stopped, configured, [stopped.id]));
  });

  it('changes when the local port changes', () => {
    expect(keyOf(stopped, configured)).not.toBe(keyOf({ ...stopped, port: '9999' }, configured));
  });

  it('stays the same when nothing rendered changed', () => {
    expect(keyOf(stopped, configured)).toBe(keyOf({ ...stopped }, configured));
  });

  it('keeps distinct forwards distinct', () => {
    const other = { ...stopped, id: 'other', service: 'wg-tunnel' };
    expect(keyOf(stopped, configured)).not.toBe(keyOf(other, configured));
  });
});

describe('sameForward', () => {
  it('matches a row against a configured entry despite the differing field names', () => {
    expect(
      sameForward(
        row({
          port: '6379',
          targetPort: '6379',
          service: 'redis',
          namespace: 'cache',
          serviceNamespace: 'cache',
        }),
        // A number where the row has a string, localPort where it has port, and
        // no serviceNamespace at all: the shape sharing actually writes.
        {
          namespace: 'cache',
          service: 'redis',
          localPort: 6379,
          targetPort: 6379,
        }
      )
    ).toBe(true);
  });

  it('ignores the id entirely', () => {
    expect(sameForward(row({ id: 'from-the-backend' }), row({ id: 'derived' }))).toBe(true);
  });

  it('keeps two forwards on different local ports apart', () => {
    expect(sameForward(row({ port: '6379' }), row({ port: '6380' }))).toBe(false);
  });

  it('prefers serviceNamespace over namespace, as the identity does', () => {
    expect(
      sameForward(
        row({ serviceNamespace: 'cache', namespace: 'other' }),
        row({ serviceNamespace: '', namespace: 'cache' })
      )
    ).toBe(true);
  });
});

describe('synthesizeMissingRows, for a forward that is already running', () => {
  // Started from a resource page: Headlamp sends an empty id and the backend
  // generates one, so it looks nothing like a derived id.
  const running = row({
    id: 'a3f9c1e2-7b44-4d0a-9c31-8e2f5b6d1027',
    pod: 'redis-master-0',
    service: 'redis-master',
    serviceNamespace: 'cache',
    namespace: 'cache',
    port: '6379',
    targetPort: '6379',
  });

  // Exactly what sharing writes into the ConfigMap: named, and without an id.
  const shared = {
    name: 'Redis Cache',
    namespace: 'cache',
    service: 'redis-master',
    localPort: '6379',
    targetPort: '6379',
    autoStart: false,
  };

  it('does not add a second row after the forward was shared', () => {
    const index = buildForwardIndex(undefined, [shared]);

    expect(synthesizeMissingRows(index, [running], 'c1')).toEqual([]);
  });

  it('does not add a second row when the entry was saved under a stale id', () => {
    const index = buildForwardIndex([{ ...shared, id: 'an-id-from-an-earlier-run' }], undefined);

    expect(synthesizeMissingRows(index, [running], 'c1')).toEqual([]);
  });

  it('still adds a row for the same service on another local port', () => {
    const index = buildForwardIndex(undefined, [shared, { ...shared, localPort: '6380' }]);
    const rows = synthesizeMissingRows(index, [running], 'c1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ port: '6380', service: 'redis-master', status: 'Stopped' });
  });
});

describe('mergeStoredForwards', () => {
  const running = row({ id: 'backend-id', status: 'Running' });

  it('adds a remembered forward the backend does not report, as stopped', () => {
    const stored = row({ id: 'other', service: 'svc-2', port: '9090' });

    expect(mergeStoredForwards([running], [stored])).toEqual([
      running,
      { ...stored, status: 'Stopped' },
    ]);
  });

  it('keeps the backend entry when the ids agree', () => {
    expect(mergeStoredForwards([running], [row({ id: 'backend-id', status: 'Stopped' })])).toEqual([
      running,
    ]);
  });

  it('drops a leftover duplicate of a forward already in the list', () => {
    // What the duplicate-row bug left behind: a second stored entry for one
    // target, under the id the synthetic row had.
    const leftover = row({ id: 'ns-svc-1-80', status: 'Stopped' });

    expect(mergeStoredForwards([running], [leftover])).toEqual([running]);
  });
});
