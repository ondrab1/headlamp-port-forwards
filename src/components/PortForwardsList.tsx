import { InlineIcon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  Loader,
  SectionBox,
  StatusLabel,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Link as MuiLink, Tooltip, Typography } from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { compareForwards, decorateRows, findConfigured, synthesizeMissingRows } from '../forwards';
import { useConfiguredForwards, usePortForwardList } from '../hooks/usePortForwardList';
import {
  addSharedForward,
  removeSharedForward,
  renameSharedForward,
  setSharedAutoStart,
} from '../sharedConfigMap';
import { removePersistentForward, setPersistentName, store } from '../store';
import { ListRow, PortForwardEntry } from '../types';
import { describeError } from '../utils';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { NameForwardDialog } from './NameForwardDialog';
import { ActionsCell, AutoStartCell, PersistCell, SelectionToolbar } from './PortForwardsCells';
import { StartOnPortDialog } from './StartOnPortDialog';

/** How a forward is made persistent, if at all. */
export function PortForwardsList() {
  const { t } = useTranslation();
  const { enqueueSnackbar } = useSnackbar();
  const { cluster, portForwards, pendingIds, start, stop, remove, runBulk } = usePortForwardList();
  const configured = useConfiguredForwards(cluster);
  const sharedRef = store.useConfig()()?.clusters?.[cluster]?.sharedConfigMap;
  const canWriteShared = !!sharedRef?.namespace && !!sharedRef?.name;
  const [startDialogFor, setStartDialogFor] = React.useState<PortForwardEntry | null>(null);
  const [deleteDialogFor, setDeleteDialogFor] = React.useState<ListRow | null>(null);
  const [nameDialog, setNameDialog] = React.useState<{
    portForward: ListRow;
    mode: 'share' | 'rename';
  } | null>(null);

  // Resolved once per row, so every cell renders from the same conclusion.
  const rows: ListRow[] = React.useMemo(
    () =>
      portForwards === null
        ? []
        : decorateRows(
            [...portForwards, ...synthesizeMissingRows(configured, portForwards, cluster)].sort(
              compareForwards
            ),
            configured,
            pendingIds
          ),
    [portForwards, configured, cluster, pendingIds]
  );

  const reportErrors = React.useCallback(
    (errors: string[], summary: string) => {
      if (errors.length === 0) {
        return;
      }
      enqueueSnackbar(`${summary}: ${errors.join('; ')}`, {
        key: 'portforward-error',
        preventDuplicate: true,
        variant: 'error',
      });
      console.error(summary, errors);
    },
    [enqueueSnackbar]
  );

  const resumeAction = React.useCallback(
    (items: PortForwardEntry[], port?: string) =>
      runBulk(items, pf => start(pf, port)).then(errors =>
        reportErrors(errors, t('Failed to start port forward'))
      ),
    [runBulk, start, reportErrors, t]
  );

  const stopAction = React.useCallback(
    (items: PortForwardEntry[]) =>
      runBulk(items, pf => stop(pf)).then(errors =>
        reportErrors(errors, t('Failed to stop port forward'))
      ),
    [runBulk, stop, reportErrors, t]
  );

  /**
   * Deletes the forward and, for locally persisted ones, its configuration.
   *
   * Deleting only the forward left the entry configured, so the row came
   * straight back as a synthetic stopped one and delete looked broken.
   */
  const deleteAction = React.useCallback(
    async (items: PortForwardEntry[], unshare = false) => {
      let unshared = 0;
      const errors = await runBulk(items, async pf => {
        const match = findConfigured(configured, pf);
        await remove(pf);
        if (match?.source === 'local') {
          removePersistentForward(cluster, match.entry);
        }
        // Deliberately after the forward is gone, and only when asked: this one
        // write is the whole team's list.
        if (unshare && match?.source === 'external' && sharedRef?.namespace && sharedRef?.name) {
          await removeSharedForward(cluster, sharedRef, match.entry);
          unshared += 1;
        }
      });
      reportErrors(errors, t('Failed to delete port forward'));

      if (unshared > 0) {
        configured.reloadShared();
        enqueueSnackbar(t('Removed from the shared ConfigMap'), { variant: 'success' });
        return;
      }

      // Nothing we deleted on our side keeps these away - say so rather than
      // letting the row reappear unexplained.
      const fromUrl = items.filter(pf => findConfigured(configured, pf)?.source === 'external');
      if (fromUrl.length > 0) {
        enqueueSnackbar(
          `${fromUrl.length} ${t(
            'forward(s) are defined by the shared ConfigMap and stay listed'
          )}`,
          { key: 'portforward-external-kept', preventDuplicate: true, variant: 'info' }
        );
      }
    },
    [runBulk, remove, reportErrors, t, configured, cluster, sharedRef, enqueueSnackbar]
  );

  /** Appends the forward to the shared ConfigMap the whole team reads. */
  const shareAction = React.useCallback(
    async (pf: PortForwardEntry, name: string) => {
      if (!sharedRef?.namespace || !sharedRef?.name) {
        return;
      }

      const entry = {
        name,
        namespace: pf.serviceNamespace || pf.namespace,
        service: pf.service,
        pod: pf.service ? undefined : pf.pod,
        localPort: pf.port,
        targetPort: pf.targetPort,
        autoStart: false,
      };

      try {
        await addSharedForward(cluster, sharedRef, entry);
        configured.reloadShared();
        enqueueSnackbar(t('Shared with the team'), { variant: 'success' });
      } catch (err) {
        const message = describeError(err);
        enqueueSnackbar(`${t('Could not write the shared ConfigMap')}: ${message}`, {
          key: 'portforward-share-error',
          preventDuplicate: true,
          variant: 'error',
        });
      }
    },
    [cluster, sharedRef, configured, enqueueSnackbar, t]
  );

  /**
   * Renames wherever the forward is defined.
   *
   * A forward that is not configured anywhere has nowhere to keep a name, which
   * is why the action is hidden for those rows.
   */
  const renameAction = React.useCallback(
    async (pf: PortForwardEntry, name: string) => {
      const match = findConfigured(configured, pf);
      if (!match) {
        return;
      }

      try {
        if (match.source === 'local') {
          // Writes to the plugin config, which is a reactive store, so the row
          // updates on its own.
          setPersistentName(cluster, match.entry, name);
        } else if (sharedRef?.namespace && sharedRef?.name) {
          await renameSharedForward(cluster, sharedRef, match.entry, name);
          configured.reloadShared();
        }
      } catch (err) {
        const message = describeError(err);
        enqueueSnackbar(`${t('Could not rename the forward')}: ${message}`, {
          key: 'portforward-rename-error',
          preventDuplicate: true,
          variant: 'error',
        });
      }
    },
    [cluster, configured, sharedRef, enqueueSnackbar, t]
  );

  /** Writes the auto-start flag of a shared forward into the ConfigMap. */
  const sharedAutoStartAction = React.useCallback(
    async (pf: PortForwardEntry, enabled: boolean) => {
      const match = findConfigured(configured, pf);
      if (!match || !sharedRef?.namespace || !sharedRef?.name) {
        return;
      }

      try {
        await setSharedAutoStart(cluster, sharedRef, match.entry, enabled);
        configured.reloadShared();
      } catch (err) {
        const message = describeError(err);
        enqueueSnackbar(`${t('Could not update auto-start')}: ${message}`, {
          key: 'portforward-autostart-error',
          preventDuplicate: true,
          variant: 'error',
        });
      }
    },
    [cluster, configured, sharedRef, enqueueSnackbar, t]
  );

  function statusCell(row: ListRow) {
    if (row.pending) {
      return (
        <Box display="flex" alignItems="center" gap={1}>
          <Loader noContainer title={t('Working on port forwarding')} size={20} />
          <Typography variant="body2" color="textSecondary">
            {row.running ? t('Stopping…') : t('Starting…')}
          </Typography>
        </Box>
      );
    }
    // A stopped forward often keeps the error of an earlier attempt. Flag it,
    // but keep showing the real status so the row does not read as unusable -
    // it can still be resumed.
    if (row.error) {
      return (
        <Tooltip title={row.error}>
          <StatusLabel status="error">{row.status || t('Error')}</StatusLabel>
        </Tooltip>
      );
    }
    return <StatusLabel status={row.running ? 'success' : ''}>{row.status}</StatusLabel>;
  }

  return (
    <SectionBox title={t('Port Forwarding')}>
      <Table
        data={rows}
        loading={portForwards === null}
        // Everything the cells render from, not just the forward id: the table
        // reuses a cached row - and its cells - whenever the id is unchanged.
        getRowId={(row: ListRow) => row.renderKey}
        enableRowSelection
        renderRowSelectionToolbar={({ table }: any) => (
          <SelectionToolbar
            selected={table.getSelectedRowModel().rows.map((row: any) => row.original)}
            onResume={resumeAction}
            onStop={stopAction}
            onClearSelection={() => table.resetRowSelection()}
          />
        )}
        columns={[
          {
            id: 'name',
            header: t('Name'),
            // Both parts are in the accessor so search matches either the
            // user-given name or the resource it forwards to.
            accessorFn: (pf: ListRow) => [pf.label, pf.service || pf.pod].filter(Boolean).join(' '),
            Cell: ({ row }: any) => {
              const pf: ListRow = row.original;
              const label = pf.label;
              const link = (
                <Link
                  routeName={pf.service ? 'service' : 'pod'}
                  params={{
                    name: pf.service || pf.pod,
                    namespace: pf.serviceNamespace || pf.namespace,
                  }}
                >
                  {pf.service || pf.pod}
                </Link>
              );

              if (!label) {
                return link;
              }

              return (
                <Box display="flex" flexDirection="column" lineHeight={1.3}>
                  <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                    {label}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    {link}
                  </Typography>
                </Box>
              );
            },
          },
          {
            id: 'namespace',
            header: t('Namespace'),
            accessorFn: (pf: ListRow) => pf.serviceNamespace || pf.namespace,
          },
          {
            id: 'kind',
            header: t('Kind'),
            accessorFn: (pf: ListRow) => (pf.service ? 'Service' : 'Pod'),
          },
          {
            id: 'podPort',
            header: t('Pod Port'),
            accessorFn: (pf: ListRow) => pf.targetPort,
          },
          {
            id: 'localPort',
            header: t('Local Port'),
            accessorFn: (pf: ListRow) => pf.port,
            Cell: ({ row }: any) => {
              const pf: ListRow = row.original;
              const url = `http://localhost:${pf.port}`;

              if (!pf.running) {
                // A real Tooltip rather than a native title: the native one did
                // not show, which left no way to tell this state apart from a
                // link that merely looks grey.
                return (
                  <Tooltip title={`${t('Not running')} — ${pf.status || '?'}`}>
                    <Box
                      component="span"
                      sx={theme => ({
                        display: 'inline-flex',
                        alignItems: 'center',
                        color: theme.palette.text.disabled,
                      })}
                    >
                      {pf.port}
                      <InlineIcon icon="mdi:open-in-new" style={{ marginLeft: '4px' }} />
                    </Box>
                  </Tooltip>
                );
              }

              return (
                <MuiLink
                  component="button"
                  type="button"
                  onClick={() => window.open(url, '_blank')}
                  title={url}
                  // The colour is set explicitly: rendered as a <button>, the
                  // link would otherwise take the user agent's button colour and
                  // look exactly like the disabled state.
                  sx={theme => ({
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: 'none',
                    border: 0,
                    padding: 0,
                    font: 'inherit',
                    cursor: 'pointer',
                    color: theme.palette.primary.main,
                    textDecoration: 'underline',
                  })}
                >
                  {pf.port}
                  <InlineIcon icon="mdi:open-in-new" style={{ marginLeft: '4px' }} />
                </MuiLink>
              );
            },
          },
          {
            id: 'status',
            header: t('Status'),
            accessorFn: (pf: ListRow) => pf.status,
            Cell: ({ row }: any) => statusCell(row.original),
          },
          {
            id: 'persist',
            header: t('Persistent'),
            gridTemplate: 'min-content',
            accessorFn: (row: ListRow) => row.configuredSource ?? 'none',
            Cell: ({ row }: any) => <PersistCell row={row.original} cluster={cluster} />,
            enableColumnFilter: false,
          },
          {
            id: 'autostart',
            header: t('Auto-start'),
            gridTemplate: 'min-content',
            accessorFn: (row: ListRow) => row.autoStart,
            Cell: ({ row }: any) => (
              <AutoStartCell
                row={row.original}
                cluster={cluster}
                onSetSharedAutoStart={
                  canWriteShared
                    ? enabled => sharedAutoStartAction(row.original, enabled)
                    : undefined
                }
              />
            ),
            enableColumnFilter: false,
          },
          {
            id: 'actions',
            header: t('Actions'),
            gridTemplate: 'min-content',
            muiTableBodyCellProps: { align: 'right' },
            accessorFn: (pf: ListRow) => pf.status,
            Cell: ({ row }: any) => {
              const pf: ListRow = row.original;
              return (
                <ActionsCell
                  portForward={pf}
                  pending={pf.pending}
                  canShare={canWriteShared && pf.configuredSource !== 'external'}
                  onResume={() => resumeAction([pf])}
                  onStop={() => stopAction([pf])}
                  onDelete={() => setDeleteDialogFor(pf)}
                  canRename={
                    pf.configuredSource === 'local' || (!!pf.configuredSource && canWriteShared)
                  }
                  onShare={() => setNameDialog({ portForward: pf, mode: 'share' })}
                  onRename={() => setNameDialog({ portForward: pf, mode: 'rename' })}
                  onStartOnAnotherPort={() => setStartDialogFor(pf)}
                />
              );
            },
            enableSorting: false,
            enableColumnFilter: false,
          },
        ]}
      />
      <NameForwardDialog
        open={!!nameDialog}
        title={nameDialog?.mode === 'share' ? t('Share with team') : t('Rename port forward')}
        target={
          nameDialog
            ? `${nameDialog.portForward.serviceNamespace || nameDialog.portForward.namespace}/${
                nameDialog.portForward.service || nameDialog.portForward.pod
              }:${nameDialog.portForward.targetPort}`
            : ''
        }
        initialName={
          nameDialog
            ? nameDialog.portForward.label ||
              nameDialog.portForward.service ||
              nameDialog.portForward.pod
            : ''
        }
        confirmLabel={nameDialog?.mode === 'share' ? t('Share') : t('Rename')}
        onCancel={() => setNameDialog(null)}
        onConfirm={name => {
          const pending = nameDialog;
          setNameDialog(null);
          if (!pending) {
            return;
          }
          if (pending.mode === 'share') {
            shareAction(pending.portForward, name);
          } else {
            renameAction(pending.portForward, name);
          }
        }}
      />
      <ConfirmDeleteDialog
        open={!!deleteDialogFor}
        target={
          deleteDialogFor
            ? `${deleteDialogFor.serviceNamespace || deleteDialogFor.namespace}/${
                deleteDialogFor.service || deleteDialogFor.pod
              }:${deleteDialogFor.targetPort}`
            : ''
        }
        label={deleteDialogFor?.label}
        shared={
          deleteDialogFor?.configuredSource === 'external'
            ? {
                location: `${sharedRef?.namespace}/${sharedRef?.name}`,
                writable: canWriteShared,
              }
            : undefined
        }
        onCancel={() => setDeleteDialogFor(null)}
        onConfirm={unshare => {
          const pf = deleteDialogFor;
          setDeleteDialogFor(null);
          if (pf) {
            deleteAction([pf], unshare);
          }
        }}
      />
      <StartOnPortDialog
        portForward={startDialogFor}
        onCancel={() => setStartDialogFor(null)}
        onConfirm={port => {
          const pf = startDialogFor;
          setStartDialogFor(null);
          if (pf) {
            resumeAction([pf], port);
          }
        }}
      />
    </SectionBox>
  );
}
