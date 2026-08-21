import {
  registerAppBarAction,
  registerPluginSettings,
  registerRoute,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { PortForwarderAction } from './components/PortForwarderAction';
import { PortForwardsList } from './components/PortForwardsList';
import { PortForwardsSettings } from './components/PortForwardsSettings';
import { PLUGIN_NAME } from './store';
import { isElectron } from './utils';
import { PLUGIN_BUILD } from './version';

console.info(`[${PLUGIN_NAME}] build ${PLUGIN_BUILD}`);

registerPluginSettings(PLUGIN_NAME, PortForwardsSettings, true);

/**
 * Replaces Headlamp's Port Forwarding page with our own.
 *
 * Plugin routes are evaluated before the default ones, so registering the same
 * path wins. Note this cannot be done with registerResourceTableColumnsProcessor:
 * Headlamp's port forward list uses the plain Table component, and column
 * processors only run inside ResourceTable.
 */
registerRoute({
  path: '/portforwards',
  exact: true,
  name: 'PortForwards',
  sidebar: 'portforwards',
  // Same guard as the built-in route: port forwarding needs the desktop app.
  disabled: !isElectron(),
  component: () => <PortForwardsList />,
});

registerAppBarAction(PortForwarderAction);
