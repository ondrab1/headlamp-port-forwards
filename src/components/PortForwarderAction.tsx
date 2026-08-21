import { Icon } from '@iconify/react';
import { Router, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { isRunning, synthesizeMissingRows } from '../forwards';
import { useConfiguredForwards, usePortForwardList } from '../hooks/usePortForwardList';
import { usePortForwardLogic } from '../hooks/usePortForwardLogic';

export function PortForwarderAction() {
  const { t } = useTranslation();
  const theme = useTheme();
  const history = useHistory();

  // Keeps the auto-start behaviour running wherever the user is in the app.
  const { settling } = usePortForwardLogic();

  // Same source as the port forwards list, so the badge can never disagree
  // with what the page shows.
  const { cluster, portForwards, fetchList } = usePortForwardList();
  const configured = useConfiguredForwards(cluster);

  // The list polls every 5s, so without an explicit refresh the count would
  // keep showing 0 for up to one interval after auto-start finished. Stay in
  // the loading state until that refresh landed.
  const [refreshedAfterSettling, setRefreshedAfterSettling] = React.useState(false);

  React.useEffect(() => {
    if (settling) {
      setRefreshedAfterSettling(false);
      return;
    }

    let cancelled = false;
    fetchList().finally(() => {
      if (!cancelled) {
        setRefreshedAfterSettling(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [settling, fetchList]);

  const { running, total } = React.useMemo(() => {
    if (!portForwards) {
      return { running: 0, total: 0 };
    }
    const rows = [...portForwards, ...synthesizeMissingRows(configured, portForwards, cluster)];
    return { running: rows.filter(isRunning).length, total: rows.length };
  }, [portForwards, configured, cluster]);

  if (!cluster) {
    return null;
  }

  // Two separate reasons the count is not meaningful yet: the list has not been
  // fetched, and the auto-start pass has not finished. Showing 0 through either
  // of them is what made the badge flip from 0/2 to 1/2 right after opening a
  // cluster.
  const loading = portForwards === null || settling || !refreshedAfterSettling;

  const stopped = total - running;
  const statusColor =
    running === 0
      ? theme.palette.text.disabled
      : stopped === 0
      ? theme.palette.success.main
      : theme.palette.warning.main;

  // Built in JS rather than via interpolation: t() falls back to the raw key
  // when the plugin catalog is not loaded, which would show the placeholders.
  const tooltip = loading
    ? t('Starting port forwards…')
    : total === 0
    ? t('No port forwards')
    : `${running} ${t('running')}, ${stopped} ${t('stopped')}`;

  return (
    <Tooltip title={tooltip}>
      <Button
        onClick={() => history.push(Router.createRouteURL('PortForwards'))}
        aria-label={t('Open Port Forwarding list')}
        size="small"
        sx={{
          textTransform: 'none',
          backgroundColor:
            theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
          '&:hover': {
            backgroundColor:
              theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          },
          borderRadius: '8px',
          padding: '4px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: theme.palette.text.primary,
        }}
      >
        <Icon
          icon="mdi:swap-horizontal"
          width="18"
          height="18"
          style={{ color: loading ? theme.palette.text.disabled : statusColor, flexShrink: 0 }}
        />
        <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
        {loading ? (
          // Same footprint as the numbers, so the app bar does not jump when the
          // count arrives.
          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 28 }}>
            <CircularProgress size={12} thickness={5} />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.25, minWidth: 28 }}>
            <Typography
              variant="body2"
              sx={{ fontWeight: 'bold', lineHeight: 1, color: statusColor }}
            >
              {running}
            </Typography>
            <Typography variant="caption" sx={{ lineHeight: 1, opacity: 0.7 }}>
              {`/ ${total}`}
            </Typography>
          </Box>
        )}
      </Button>
    </Tooltip>
  );
}
