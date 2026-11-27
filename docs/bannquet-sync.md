# Bannquet sync

Tom's photos and routes are copied from this site's Sanity dataset to his Bannquet profile ([@tomvans](https://www.bannquet.com)). The sync lives in the Bannquet repo. Nothing in this repo runs it, and no code here depends on it.

## What syncs

- **Direction:** one way, from Sanity (`lee2r8sa` / `production`) to Bannquet. Bannquet never writes to Sanity.
- **Content:** published `photo` and `track` documents. Drafts and versions are ignored.
- **Skipped:** `flight` documents. Aerial (drone) photos still sync, as ordinary photos.
- **Images:** copied into Bannquet's own storage (Vercel Blob) at 2000 px on the long edge, plus a 480 px thumbnail. Bannquet never reads Sanity when someone views a page.

## Edits and deletes

- **Deleting in Sanity** removes the item from Bannquet.
- **Deleting on Bannquet** hides that item there for good (it's recorded in Bannquet's `sync_exclusions` table). It stays on tomvanz.com.
- **Editing on Bannquet** sticks until the item is published again in Sanity. Then Sanity's version wins.

## Photo-to-route links

Bannquet links a photo to a route with the same rule this site uses (see `takenAt` matching in `AGENTS.md`). Both must belong to the same owner, the photo must be taken inside the route's start and end time (5 s before to 15 s after), and it must be within about 200 m of the line.

## Ongoing sync (webhook)

A Sanity webhook sends changes to `https://www.bannquet.com/api/sync/sanity`, signed with a shared secret. It is created in [sanity.io/manage](https://www.sanity.io/manage) for project `lee2r8sa` once the Bannquet side ships. Settings:

| Setting | Value |
| --- | --- |
| Dataset | `production` |
| Triggers | create, update, delete |
| Filter | `_type in ["photo","track"]` |
| Drafts / versions | off |
| Projection | `{_id, _type, _rev, "op": delta::operation()}` |

## Running it by hand

From the Bannquet repo:

```bash
npx tsx scripts/sync-tomvanz.ts --dry-run   # show what would change
npx tsx scripts/sync-tomvanz.ts             # apply
npx tsx scripts/sync-tomvanz.ts --force     # re-pull everything
```

## If you change the content model

Renaming or reshaping `photo` or `track` fields (for example `route.coordinates`, `displayCoordinates`, `image`, `takenAt`, `location`) breaks the sync. Update the Bannquet sync in the same change.
