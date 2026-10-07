#!/usr/bin/env python3
"""Apply the publish scrub tables to a directory of git patches.

The umbrella repository is private and the published one is not, so anything
personal has to be replaced on the way out. A full rebuild runs
`git-filter-repo --replace-text` over the whole history; an incremental publish
has to get the same result out of `git format-patch` output before `git am`,
which is what this does.

Usage:
    python app/scripts/publish-scrub.py <table> <patch-dir> [--incremental]

`<table>` is the umbrella root's `publish-scrub-expressions.txt`. Rules that
only make sense for a full rebuild live beside it in
`publish-scrub-rebuild-only.txt` and are loaded automatically — except with
`--incremental`, which skips them. Those rules were added after the public
history was cut, so the already-published files still contain the original
text; rewriting a patch's *context* lines with them makes `git am` fail with
"patch does not apply".

Neither table may contain comment lines, and this script refuses them: the same
files are fed to git-filter-repo, which does NOT support comments and turns
every line into a rule. A stray `#` line becomes "replace every # in every file
with ***REMOVED***", which quietly destroys the published tree.
"""

import io
import os
import sys


def load_rules(table_path):
    rules = []
    with io.open(table_path, encoding='utf-8') as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.rstrip('\r\n')
            if not line.strip():
                continue
            if line.lstrip().startswith('#'):
                raise SystemExit(
                    '%s:%d: comment lines are not allowed. git-filter-repo reads the same\n'
                    'file and treats every line as a rule, so a "#" line becomes "replace\n'
                    'every # with ***REMOVED***". Put the explanation in HANDOFF instead.'
                    % (table_path, lineno)
                )
            if not line.startswith('literal:'):
                raise SystemExit(
                    '%s:%d: only literal: rules are handled: %s' % (table_path, lineno, line)
                )
            # Split on the LAST '==>', exactly like git-filter-repo, and take the
            # right hand side verbatim: a 'literal:' prefix there is not syntax,
            # it is text that ends up written into the published files.
            src, sep, dst = line[len('literal:'):].rpartition('==>')
            if not sep:
                raise SystemExit('%s:%d: expression has no ==> replacement' % (table_path, lineno))
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

    tables = [table_path]
    rebuild_only = os.path.join(os.path.dirname(os.path.abspath(table_path)),
                                'publish-scrub-rebuild-only.txt')
    if incremental:
        if os.path.exists(rebuild_only):
            print('  skip (rebuild-only table): %s' % os.path.basename(rebuild_only))
    elif os.path.exists(rebuild_only):
        tables.append(rebuild_only)
    else:
        print('  warning: no rebuild-only table at %s' % rebuild_only)

    rules = []
    for table in tables:
        loaded = load_rules(table)
        print('%s: %d rules' % (os.path.basename(table), len(loaded)))
        rules.extend(loaded)
    rules.sort(key=lambda r: -len(r[0]))

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
