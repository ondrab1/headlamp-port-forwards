import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Switch,
  Tooltip,
} from '@mui/material';
import React from 'react';
import { isRunning, isStopped } from '../forwards';
import { addPersistentForward, removePersistentForward, setAutoStart } from '../store';
import { ListRow, PortForwardEntry } from '../types';

/**
 * Shows how the forward is persisted, and toggles it for local ones.
 *
 * Forwards coming from the shared ConfigMap are persistent as well, but pinning
 * them would only create a redundant local copy, so those are read-only here.
 */
export function PersistCell({ row, cluster }: { row: ListRow; cluster: string }) {
  const { t } = useTranslation();

  if (row.configuredSource === 'external') {
    return (
      <Tooltip title={t('Defined in the shared ConfigMap')}>
        <Box display="flex" alignItems="center" px={0.5}>
          <Icon icon="mdi:cloud-check-outline" width="20" style={{ color: 'gray' }} />
        </Box>
      </Tooltip>
    );
  }

  const persisted = row.configuredSource === 'local';

  // The stored entry, not the row id: the row may have been matched to it by
  // target, in which case its id is the backend's and no entry carries it.
  function toggle() {
    if (!persisted) {
      addPersistentForward(cluster, row);
      return;
    }
    if (row.configuredEntry) {
      removePersistentForward(cluster, row.configuredEntry);
    }
  }

  return (
    <IconButton
      size="small"
      title={persisted ? t('Remove from persistent forwards') : t('Save as persistent')}
      onClick={toggle}
    >
      <Icon
        icon={persisted ? 'mdi:pin' : 'mdi:pin-outline'}
        width="20"
        style={persisted ? { color: 'green' } : { opacity: 0.6 }}
      />
    </IconButton>
  );
}

/**
 * Toggles whether the forward starts by itself when entering the cluster.
 *
 * Editable for both sources: the plugin owns the settings, and it writes the
 * shared ConfigMap too.
 */
export function AutoStartCell({
  row,
  cluster,
  onSetSharedAutoStart,
}: {
  row: ListRow;
  cluster: string;
  /** Writes the flag into the shared ConfigMap; absent when it is not writable. */
  onSetSharedAutoStart?: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();

  if (!row.configuredSource) {
    return (
      <Tooltip title={t('Save this forward, or share it, to let it start automatically')}>
        <Box display="flex" alignItems="center" px={0.5} sx={{ opacity: 0.4 }}>
          —
        </Box>
      </Tooltip>
    );
  }

  if (row.configuredSource === 'external') {
    if (!onSetSharedAutoStart) {
      return (
        <Tooltip title={t('Auto-start is set in the shared ConfigMap')}>
          <Box display="flex" alignItems="center" px={0.5}>
            <Icon
              icon={row.autoStart ? 'mdi:lightning-bolt' : 'mdi:lightning-bolt-outline'}
              width="20"
              style={row.autoStart ? { color: 'green' } : { opacity: 0.4 }}
            />
          </Box>
        </Tooltip>
      );
    }

    return (
      <Tooltip title={t('Auto-start for the whole team, stored in the shared ConfigMap')}>
        <Switch
          size="small"
          color="secondary"
          checked={row.autoStart}
          inputProps={{ 'aria-label': t('Auto-start') }}
          onChange={event => onSetSharedAutoStart(event.target.checked)}
        />
      </Tooltip>
    );
  }

  const entry = row.configuredEntry;

  return (
    <Switch
      size="small"
      checked={row.autoStart}
      inputProps={{ 'aria-label': t('Auto-start') }}
      title={row.autoStart ? t('Disable auto-start') : t('Enable auto-start')}
      // Same as above: keyed on the stored entry, since the row id need not
      // appear anywhere in the settings.
      onChange={event => entry && setAutoStart(cluster, entry, event.target.checked)}
    />
  );
}

/**
 * Primary action for the row plus an overflow menu.
 *
 * Stopped forwards get a one-click Resume, which is the difference to
 * Headlamp's own list where Start always goes through the port dialog.
 */
export function ActionsCell({
  portForward,
  pending,
  canShare,
  canRename,
  onResume,
  onStop,
  onDelete,
  onShare,
  onRename,
  onStartOnAnotherPort,
}: {
  portForward: PortForwardEntry;
  pending: boolean;
  canShare: boolean;
  canRename: boolean;
  onResume: () => void;
  onStop: () => void;
  onDelete: () => void;
  onShare: () => void;
  onRename: () => void;
  onStartOnAnotherPort: () => void;
}) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const running = isRunning(portForward);
  const stopped = isStopped(portForward);

  function closeMenu() {
    setAnchorEl(null);
  }

  return (
    <Box display="flex" alignItems="center" justifyContent="flex-end">
      {/* In the button's own place, so the click is acknowledged where the eye
          already is - starting takes a moment, and the status column may be
          scrolled out of sight or hidden. */}
      {pending && (
        <Box display="flex" alignItems="center" justifyContent="center" width={30} height={30}>
          <CircularProgress
            size={18}
            color="primary"
            aria-label={running ? t('Stopping port forward') : t('Starting port forward')}
          />
        </Box>
      )}
      {stopped && !pending && (
        <IconButton
          size="small"
          color="primary"
          title={t('Resume port forward')}
          aria-label={t('Resume port forward')}
          onClick={onResume}
        >
          <Icon icon="mdi:play-circle-outline" width="20" />
        </IconButton>
      )}
      {running && !pending && (
        <IconButton
          size="small"
          color="primary"
          title={t('Stop port forward')}
          aria-label={t('Stop port forward')}
          onClick={onStop}
        >
          <Icon icon="mdi:stop-circle-outline" width="20" />
        </IconButton>
      )}
      <IconButton
        size="small"
        disabled={pending}
        aria-label={t('Actions')}
        onClick={event => setAnchorEl(event.currentTarget)}
      >
        <Icon icon="mdi:more-vert" width="20" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={closeMenu}>
        {stopped && (
          <MenuItem
            onClick={() => {
              closeMenu();
              onStartOnAnotherPort();
            }}
          >
            <ListItemText>{t('Start on another port…')}</ListItemText>
          </MenuItem>
        )}
        {canRename && (
          <MenuItem
            onClick={() => {
              closeMenu();
              onRename();
            }}
          >
            <ListItemText>{t('Rename…')}</ListItemText>
          </MenuItem>
        )}
        {canShare && (
          <MenuItem
            onClick={() => {
              closeMenu();
              onShare();
            }}
          >
            <ListItemText>{t('Share with team…')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            closeMenu();
            onDelete();
          }}
        >
          <ListItemText>{t('Delete')}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

/** Resume / Stop for every selected row, shown while rows are selected. */
export function SelectionToolbar({
  selected,
  onResume,
  onStop,
  onClearSelection,
}: {
  selected: PortForwardEntry[];
  onResume: (items: PortForwardEntry[]) => void;
  onStop: (items: PortForwardEntry[]) => void;
  onClearSelection: () => void;
}) {
  const { t } = useTranslation();
  const stoppedSelected = selected.filter(isStopped);
  const runningSelected = selected.filter(isRunning);

  return (
    <Box display="flex" alignItems="center" gap={1} px={1}>
      <Button
        size="small"
        startIcon={<Icon icon="mdi:play-circle-outline" />}
        disabled={stoppedSelected.length === 0}
        onClick={() => {
          onResume(stoppedSelected);
          onClearSelection();
        }}
      >
        {`${t('Resume')} (${stoppedSelected.length})`}
      </Button>
      <Button
        size="small"
        startIcon={<Icon icon="mdi:stop-circle-outline" />}
        disabled={runningSelected.length === 0}
        onClick={() => {
          onStop(runningSelected);
          onClearSelection();
        }}
      >
        {`${t('Stop')} (${runningSelected.length})`}
      </Button>
    </Box>
  );
}

/**
 * Replacement for Headlamp's Port Forwarding page.
 *
 * It keeps the built-in columns and actions, and adds one-click Resume for
 * stopped forwards, bulk Resume/Stop, and a column to persist a forward so the
 * plugin re-creates it on the next app start.
 */
