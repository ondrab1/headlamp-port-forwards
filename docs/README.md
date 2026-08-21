# Screenshots

Both files are referenced from the top-level README. Take them on a demo or dev cluster where
possible.

## `port-forwarding-list.png`

What it should show:

- two or three forwards, at least one running and one stopped
- a shared one (cloud icon in Persistent) and a locally pinned one (green pin)
- auto-start on for at least one row, so the toggle is visible
- custom names in the Name column

## `plugin-settings.png`

The plugin's settings page, showing:

- the ConfigMap namespace and name filled in
- the green status line confirming how many shared forwards were found
- the list of configured forwards underneath, with an auto-start switch

The interesting states are the ones people hit first, so a screenshot taken while the ConfigMap
still does not exist — with the **Create namespace + ConfigMap** and **Copy YAML** buttons — is
worth more than one of the happy path.

## Please note

Avoid production namespace and service names in either file. The shared list describes internal
topology, and these end up in the repository.
