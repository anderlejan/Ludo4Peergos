#!/usr/bin/env python3
"""Builds the installable Peergos app ZIP of the current version.

  python3 tools/make_release.py            release: needs a clean git tree; writes
                                           <out>/Ludo4Peergos-v<ver>.zip            (install this in Peergos)
                                           <out>/Ludo4Peergos-Source-v<ver>.zip     (git archive of the same commit)
                                           <out>/SHA256SUMS.txt                     (appended)
                                           and tags the commit v<ver>
  python3 tools/make_release.py --dev      test build to <out>/dev/Ludo4Peergos-v<ver>-dev.zip (may be replaced)
  options: --out DIR (default: ../releases next to the repository), --skip-tests

A released version is never overwritten: the script refuses when the ZIP exists. Fix → bump the version.
"""
import hashlib, json, os, re, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[1:]
DEV = '--dev' in ARGS
OUT = os.path.abspath(ARGS[ARGS.index('--out') + 1]) if '--out' in ARGS else os.path.join(os.path.dirname(ROOT), 'releases')
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def die(msg):
    print('REFUSED: ' + msg)
    sys.exit(1)


def git(*a):
    return subprocess.run(['git', '-C', ROOT] + list(a), capture_output=True, text=True, check=True).stdout


def check_manifest():
    with open(os.path.join(ROOT, 'peergos-app.json'), encoding='utf-8') as f:
        m = json.load(f)
    for k in ('displayName', 'description', 'launchable'):
        if k not in m:
            die('manifest: missing ' + k)
    if m.get('schemaVersion', '1') != '1':
        die('manifest: schemaVersion must be "1"')
    if len(m['displayName']) > 25 or not re.fullmatch(r'[A-Za-z0-9 _-]+', m['displayName']):
        die('manifest: displayName must be ≤ 25 chars of letters, digits, space, - and _')
    if len(m['description']) > 100:
        die('manifest: description longer than 100 characters')
    if len(m.get('author', '')) > 32:
        die('manifest: author longer than 32 characters')
    if not re.fullmatch(r'\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?', m.get('version', '')):
        die('manifest: version must be major.minor.patch[-suffix]')
    if m.get('name') != 'ludo4peergos':
        die('manifest: name must stay "ludo4peergos" (it is the app identity and the chat id prefix)')
    icon = os.path.join(ROOT, 'assets', m.get('appIcon', ''))
    if not os.path.isfile(icon) or open(icon, 'rb').read(8) != b'\x89PNG\r\n\x1a\n':
        die('manifest: appIcon must be a PNG in assets/')
    return m


def check_version(ver):
    js = open(os.path.join(ROOT, 'assets', 'js', 'version.js'), encoding='utf-8').read()
    found = re.search(r"VERSION = '([^']+)'", js)
    if not found or found.group(1) != ver:
        die('assets/js/version.js (%s) does not match peergos-app.json (%s)' % (found and found.group(1), ver))
    log = open(os.path.join(ROOT, 'CHANGELOG.md'), encoding='utf-8').read()
    if not re.search(r'^## \[?%s\]?' % re.escape(ver), log, re.M):
        die('CHANGELOG.md has no section for ' + ver)


def check_self_contained():
    """The Peergos sandbox blocks every external request: no URLs to other hosts in code or styles."""
    bad = []
    for base, _, files in os.walk(os.path.join(ROOT, 'assets')):
        for fn in files:
            if not fn.endswith(('.js', '.css', '.html')):
                continue
            p = os.path.join(base, fn)
            text = open(p, encoding='utf-8').read()
            for m in re.finditer(r'(?:src|href|url)\s*[=(]\s*["\']?(https?:)?//', text):
                bad.append(os.path.relpath(p, ROOT))
            for m in re.finditer(r"fetch\(\s*['\"]https?://", text):
                bad.append(os.path.relpath(p, ROOT))
    if bad:
        die('external references in: ' + ', '.join(sorted(set(bad))))


def run_tests():
    r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'unit.test.js')], capture_output=True, text=True)
    print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr)
    if r.returncode != 0:
        die('unit tests failed')
    for f in os.listdir(os.path.join(ROOT, 'assets', 'js')):
        if f.endswith('.js'):
            r = subprocess.run(['node', '--check', os.path.join(ROOT, 'assets', 'js', f)], capture_output=True, text=True)
            if r.returncode != 0:
                die('syntax error in ' + f + ':\n' + r.stderr)


def app_files():
    files = ['peergos-app.json']
    for base, dirs, fs in os.walk(os.path.join(ROOT, 'assets')):
        dirs.sort()
        for fn in sorted(fs):
            files.append(os.path.relpath(os.path.join(base, fn), ROOT).replace(os.sep, '/'))
    return files


def build_zip(path, files):
    with zipfile.ZipFile(path, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in files:
            info = zipfile.ZipInfo(rel, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(os.path.join(ROOT, rel), 'rb') as f:
                z.writestr(info, f.read())
    with zipfile.ZipFile(path) as z:
        if z.testzip() is not None or sorted(z.namelist()) != sorted(files):
            os.remove(path)
            die('the ZIP did not verify')


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    m = check_manifest()
    ver = m['version']
    check_version(ver)
    check_self_contained()
    if '--skip-tests' not in ARGS:
        run_tests()
    files = app_files()
    if DEV:
        os.makedirs(os.path.join(OUT, 'dev'), exist_ok=True)
        path = os.path.join(OUT, 'dev', 'Ludo4Peergos-v%s-dev.zip' % ver)
        if os.path.exists(path):
            os.remove(path)
        build_zip(path, files)
        print('dev build: %s (%d files, %d bytes)' % (path, len(files), os.path.getsize(path)))
        return
    if git('status', '--porcelain').strip():
        die('uncommitted changes – commit first (a release is built from a commit)')
    tracked = set(git('ls-files').split('\n'))
    untracked_assets = [f for f in files if f not in tracked]
    if untracked_assets:
        die('files in the app that are not committed: ' + ', '.join(untracked_assets))
    tag = 'v' + ver
    if tag in git('tag', '--list', tag).split():
        die('tag %s exists already – bump the version' % tag)
    os.makedirs(OUT, exist_ok=True)
    app_zip = os.path.join(OUT, 'Ludo4Peergos-%s.zip' % tag)
    src_zip = os.path.join(OUT, 'Ludo4Peergos-Source-%s.zip' % tag)
    for p in (app_zip, src_zip):
        if os.path.exists(p):
            die(os.path.basename(p) + ' exists already – released versions are never overwritten; bump the version')
    build_zip(app_zip, files)
    commit = git('rev-parse', 'HEAD').strip()
    subprocess.run(['git', '-C', ROOT, 'archive', '--format=zip', '--prefix=Ludo4Peergos-%s/' % ver, '-o', src_zip, commit], check=True)
    with zipfile.ZipFile(src_zip) as z:
        listed = sorted(n[len('Ludo4Peergos-%s/' % ver):] for n in z.namelist() if not n.endswith('/'))
    if listed != sorted(f for f in git('ls-tree', '-r', '--name-only', commit).split('\n') if f):
        os.remove(app_zip); os.remove(src_zip)
        die('the source ZIP does not list the same files as the commit')
    with open(os.path.join(OUT, 'SHA256SUMS.txt'), 'a', encoding='utf-8') as f:
        for p in (app_zip, src_zip):
            f.write('%s  %s\n' % (sha256(p), os.path.basename(p)))
    subprocess.run(['git', '-C', ROOT, 'tag', '-a', tag, '-m', 'Ludo4Peergos ' + ver, commit], check=True,
                   env=dict(os.environ, GIT_COMMITTER_DATE=git('log', '-1', '--format=%cI', commit).strip()))
    print('released %s from %s\n  %s (%d bytes)\n  %s (%d bytes)' % (ver, commit[:10], app_zip, os.path.getsize(app_zip), src_zip, os.path.getsize(src_zip)))


if __name__ == '__main__':
    main()
