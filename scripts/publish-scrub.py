#!/usr/bin/env python3
"""Apply the publish scrub table to a directory of git patches.

The umbrella repository is private and the published one is not, so anything
personal has to be replaced on the way out. A full rebuild runs
`git-filter-repo --replace-text` over the whole history; an incremental publish
has to get the same result out of `git format-patch` output before `git am`,
which is what this does.

Usage:
    python app/scripts/publish-scrub.py <table> <patch-dir> [--incremental]

The table is the umbrella root's `publish-scrub-expressions.txt` (it lives
outside app/ on purpose, so it never reaches the public repository). Lines are
`literal:FROM==>TO`, split on the **last** `==>`, exactly the way
git-filter-repo does it; the right-hand side is the replacement text verbatim,
so it must not carry a `literal:` prefix (one is tolerated and stripped, because
an older version of the table had it and that prefix ended up written into the
published files).

`--incremental` skips every rule below a `# rebuild-only:` marker in the table.
Those rules were added after the public history was cut, so the already-published
files still contain the original text; rewriting a patch's *context* lines with
them makes `git am` fail with "patch does not apply". They are still correct —
and necessary — for a full rebuild.
"""

import io
import os
import sys


def load_rules(table_path, incremental):
    rules = []
    rebuild_only = False
    with io.open(table_path, encoding='utf-8') as fh:
        for line in fh:
            line = line.rstrip('\r\n')
            stripped = line.strip()
            if stripped.startswith('#'):
                if stripped.startswith('# rebuild-only:'):
                    rebuild_only = True
                continue
            if not stripped:
                continue
            if not line.startswith('literal:'):
                raise SystemExit('unsupported expression (only literal: is handled): ' + line)
            src, sep, dst = line[len('literal:'):].rpartition('==>')
            if not sep:
                raise SystemExit('expression has no ==> replacement: ' + line)
            if dst.startswith('literal:'):
                # Legacy table format. The prefix is not part of the replacement;
                # keeping it writes "literal:" into the published files.
                dst = dst[len('literal:'):]
            if incremental and rebuild_only:
                print('  skip (rebuild-only): %s' % src[:40])
                continue
            rules.append((src, dst))
    # Longest source first, so a specific path wins over its own prefix.
    rules.sort(key=lambda r: -len(r[0]))
    return rules


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    incremental = '--incremental' in sys.argv
    if len(args) != 2:
        raise SystemExit(__doc__)
    table_path, patch_dir = args

    rules = load_rules(table_path, incremental)
    print('scrub rules: %d (%s)' % (len(rules), 'incremental' if incremental else 'full'))

    names = sorted(n for n in os.listdir(patch_dir) if n.endswith('.patch'))
    if not names:
        raise SystemExit('no .patch files in ' + patch_dir)

    total = 0
    for name in names:
        path = os.path.join(patch_dir, name)
        with io.open(path, encoding='utf-8', newline='') as fh:
            text = fh.read()
        hits = {}
        for src, dst in rules:
            count = text.count(src)
            if count:
                hits[src] = count
                text = text.replace(src, dst)
        # newline='' keeps the patch byte-exact apart from the replacements;
        # git am is picky about line endings.
        with io.open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(text)
        total += sum(hits.values())
        summary = ', '.join('%s x%d' % (k[:32], v) for k, v in hits.items()) or 'clean'
        print('  %-60s %s' % (name[:60], summary))
    print('patches: %d, replacements: %d' % (len(names), total))


if __name__ == '__main__':
    main()
