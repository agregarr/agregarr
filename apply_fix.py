#!/usr/bin/env python3
"""Apply the Maintainerr season-overlay fix to an agregarr checkout.

Run from the repo root:  python3 apply_fix.py
Idempotent: refuses to double-apply.
"""
import sys, os

EDITS = []

EDITS.append((
    "server/lib/overlays/OverlayContextBuilder.ts",
"""      for (const collection of maintainerrCollections) {
        const mediaItem = collection.media.find((m) => {
          const id = m.mediaServerId || m.plexId?.toString();
          return id === item.ratingKey;
        });

        if (mediaItem && collection.deleteAfterDays) {
          // Calculate days since item was added to collection
          const addedDate = new Date(mediaItem.addDate);
          const now = new Date();
          const daysSinceAdded = Math.floor(
            (now.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Calculate days until action: deleteAfterDays - daysSinceAdded
          // Positive = days remaining, negative = overdue
          const daysUntilAction = collection.deleteAfterDays - daysSinceAdded;

          matchingCollections.push({ collection, daysUntilAction });
        }
      }""",
"""      // Number of child items (seasons/episodes) matched via the tmdbId
      // fallback below, so templates can distinguish "this whole show is
      // leaving" from "2 of its seasons are leaving".
      let childItemsMatched = 0;

      for (const collection of maintainerrCollections) {
        if (!collection.deleteAfterDays) {
          continue;
        }

        // Primary match: the collection member is this exact Plex item.
        // Applies to movie-type collections and show-type collections.
        let mediaItems = collection.media.filter((m) => {
          const id = m.mediaServerId || m.plexId?.toString();
          return id === item.ratingKey;
        });

        // Fallback for season- and episode-type Maintainerr collections.
        // Their members are season/episode ratingKeys, which can never equal
        // the show's ratingKey, so the primary match always misses and
        // daysUntilAction is never calculated for TV. Maintainerr reports the
        // parent series' tmdbId on those rows, so match the show to its queued
        // children that way. A show may have several queued seasons; collect
        // them all and let the existing lowest-daysUntilAction selection win.
        if (mediaItems.length === 0 && mediaType === 'show' && tmdbId) {
          mediaItems = collection.media.filter((m) => m.tmdbId === tmdbId);
          childItemsMatched += mediaItems.length;
        }

        for (const mediaItem of mediaItems) {
          // Calculate days since item was added to collection
          const addedDate = new Date(mediaItem.addDate);
          const now = new Date();
          const daysSinceAdded = Math.floor(
            (now.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Calculate days until action: deleteAfterDays - daysSinceAdded
          // Positive = days remaining, negative = overdue
          const daysUntilAction = collection.deleteAfterDays - daysSinceAdded;

          matchingCollections.push({ collection, daysUntilAction });
        }
      }""",
))

EDITS.append((
    "server/lib/overlays/OverlayContextBuilder.ts",
"""        context.daysUntilAction = selected.daysUntilAction;

        logger.debug('Calculated Maintainerr daysUntilAction', {
          label: 'OverlayContextBuilder',
          ratingKey: item.ratingKey,
          title: item.title,
          matchingCollections: matchingCollections.length,
          selectedCollection: selected.collection.title,
          daysUntilAction: selected.daysUntilAction,
        });""",
"""        context.daysUntilAction = selected.daysUntilAction;

        if (childItemsMatched > 0) {
          context.seasonsLeavingCount = childItemsMatched;
        }

        logger.debug('Calculated Maintainerr daysUntilAction', {
          label: 'OverlayContextBuilder',
          ratingKey: item.ratingKey,
          title: item.title,
          matchingCollections: matchingCollections.length,
          childItemsMatched,
          selectedCollection: selected.collection.title,
          daysUntilAction: selected.daysUntilAction,
        });""",
))

EDITS.append((
    "server/lib/overlays/OverlayTemplateRenderer.ts",
"""  // Maintainerr integration
  daysUntilAction?: number; // Days until Maintainerr takes action (negative = overdue)""",
"""  // Maintainerr integration
  daysUntilAction?: number; // Days until Maintainerr takes action (negative = overdue)
  seasonsLeavingCount?: number; // Number of this show's seasons/episodes queued for action""",
))

EDITS.append((
    "server/routes/overlayTemplates.ts",
"""  daysUntilAction?: number;
}""",
"""  daysUntilAction?: number;
  seasonsLeavingCount?: number;
}""",
))

EDITS.append((
    "server/api/maintainerr.ts",
"""  type: number;""",
"""  type: number | 'movie' | 'show' | 'season' | 'episode';""",
))


def main():
    if not os.path.isdir("server/lib/overlays"):
        sys.exit("Run this from the agregarr repo root.")

    # Pre-flight: verify every target is present exactly once.
    for path, old, new in EDITS:
        if not os.path.exists(path):
            sys.exit("Missing file: %s" % path)
        text = open(path, encoding="utf-8").read()
        if new in text:
            sys.exit("Already applied (found new text in %s). Nothing to do." % path)
        count = text.count(old)
        if count != 1:
            sys.exit(
                "Expected exactly 1 match in %s, found %d. Upstream has moved; "
                "the patch needs rebasing." % (path, count)
            )

    for path, old, new in EDITS:
        text = open(path, encoding="utf-8").read()
        open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
        print("patched %s" % path)

    print("\nDone. Verify with:  git --no-pager diff --stat")
    print("Expected: 4 files changed, 33 insertions(+), 3 deletions(-)")


if __name__ == "__main__":
    main()
