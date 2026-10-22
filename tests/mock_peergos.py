#!/usr/bin/env python3
"""A small stand-in for the Peergos app sandbox, for fast browser tests of Ludo4Peergos.

Every user gets their own port (= own browser origin, like Peergos gives every app its own origin):
  python3 tests/mock_peergos.py 8801:alice 8802:bob 8803:carol
Open http://localhost:8801/index.html?username=alice&pgi=t&theme=dark-mode

It serves assets/ and implements the parts of /peergos-api the app uses:
  /peergos-api/v0/data/<path>   GET / PUT / DELETE (per user, in memory)
  /peergos-api/v0/chat/         POST (create, invites the first maxInvites other users) / GET list
  /peergos-api/v0/chat/<id>     PUT {text} / DELETE (a member's DELETE adds a RemoveMember entry, as the owner's Peergos does)
  /peergos-api/v1/chat/         GET list with members
  /peergos-api/v1/chat/<id>     GET ?startIndex=
  /peergos-api/v0/print/        POST (accepted, ignored)
Test hooks: GET /mock/state (JSON dump), POST /mock/invite-order {"order": ["bob", ...]},
POST /mock/join {"chat", "user"}, POST /mock/hide-list {"user", "v0": bool, "v1": bool} (leave chats out of a list),
POST /mock/hang {"user", "paths": [prefix, ...]} (never answer those GET requests),
POST /mock/delay {"user", "paths": [prefix, ...], "seconds": s} (answer those GET requests slowly).
"""
import json, sys, threading, time, uuid, os, io
from email.parser import BytesParser
from email.policy import default as email_default
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.environ.get('MOCK_ROOT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
LOCK = threading.Lock()
DATA = {}      # user -> {path: bytes}
CHATS = {}     # id -> {owner, title, members:[...], joined:set, messages:[...]}
USERS = []
INVITE_ORDER = []
HIDE = {}      # user -> {'v0': bool, 'v1': bool}: pretend Peergos leaves the chats out of that list
HANG = {}      # user -> [path prefixes]: pretend Peergos never answers these requests (as its chat list can)
DELAY = {}     # user -> {'paths': [prefixes], 'seconds': s}: slow answers, as for a player far from the server
LATENCY = float(os.environ.get('MOCK_LATENCY', '0.05'))
MIME = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown', '.svg': 'image/svg+xml'}


def now():
    return time.strftime('%Y-%m-%d %H:%M:%S')


def make_handler(user):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body=b'', ctype='application/json', headers=None):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if body and self.command != 'HEAD':
                self.wfile.write(body)

        def body(self):
            n = int(self.headers.get('Content-Length') or 0)
            return self.rfile.read(n) if n else b''

        def form_or_json(self, raw):
            ctype = self.headers.get('Content-Type', '')
            if ctype.startswith('multipart/form-data'):
                msg = BytesParser(policy=email_default).parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + raw)
                out = {}
                for part in msg.iter_parts():
                    name = part.get_param('name', header='content-disposition')
                    if name:
                        out[name] = part.get_payload(decode=True).decode('utf-8')
                return out
            try:
                return json.loads(raw.decode('utf-8') or '{}')
            except Exception:
                return {}

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            u = urlparse(self.path)
            p = unquote(u.path)
            q = parse_qs(u.query)
            time.sleep(LATENCY)
            if any(p.startswith(x) for x in HANG.get(user, [])):
                time.sleep(3600)
                return
            d = DELAY.get(user)
            if d and any(p.startswith(x) for x in d['paths']):
                time.sleep(d['seconds'])
            if p == '/mock/state':
                with LOCK:
                    return self.send(200, json.dumps({'chats': {k: dict(v, joined=list(v['joined'])) for k, v in CHATS.items()},
                                                      'data': {us: {k: v.decode('utf-8', 'replace') for k, v in d.items()} for us, d in DATA.items()}}).encode())
            if p.startswith('/peergos-api/v0/data/'):
                key = p[len('/peergos-api/v0/data/'):]
                with LOCK:
                    d = DATA.setdefault(user, {})
                    if key in d:
                        return self.send(200, d[key], 'application/octet-stream')
                    sub = key.rstrip('/') + '/'
                    files = [k[len(sub):] for k in d if k.startswith(sub) and '/' not in k[len(sub):]]
                    if files:
                        return self.send(200, json.dumps({'files': files, 'subFolders': []}).encode(), 'text/plain')
                return self.send(404)
            if p in ('/peergos-api/v1/chat/', '/peergos-api/v1/chat'):
                with LOCK:
                    mine = [(k, c) for k, c in CHATS.items() if user in c['joined'] and not HIDE.get(user, {}).get('v1')]
                    chats = [{'chatId': k, 'title': c['title'], 'members': c['members'], 'admins': [c['owner']]} for k, c in mine]
                    latest = [{'message': '', 'creationTime': c['messages'][-1]['timestamp'] if c['messages'] else now()} for k, c in mine]
                return self.send(200, json.dumps({'chats': chats, 'latestMessages': latest}).encode())
            if p in ('/peergos-api/v0/chat/', '/peergos-api/v0/chat'):
                with LOCK:
                    out = [{'chatId': k, 'title': c['title']} for k, c in CHATS.items() if user in c['joined'] and not HIDE.get(user, {}).get('v0')]
                return self.send(200, json.dumps(out).encode())
            if p.startswith('/peergos-api/v1/chat/'):
                cid = p[len('/peergos-api/v1/chat/'):]
                start = int((q.get('startIndex') or ['0'])[0])
                with LOCK:
                    c = CHATS.get(cid)
                    if not c or user not in c['joined']:
                        return self.send(400)
                    msgs = c['messages'][start:]
                    return self.send(200, json.dumps({'chatId': cid, 'startIndex': start + len(msgs), 'messages': msgs, 'hasFriendsInChat': True}).encode())
            # static assets
            rel = p.lstrip('/') or 'index.html'
            f = os.path.normpath(os.path.join(ROOT, rel))
            if not f.startswith(os.path.normpath(ROOT)) or not os.path.isfile(f):
                return self.send(404, b'not found', 'text/plain')
            with open(f, 'rb') as fh:
                data = fh.read()
            return self.send(200, data, MIME.get(os.path.splitext(f)[1], 'application/octet-stream'),
                             {'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' data:; media-src 'self' data: blob:;"})

        def do_PUT(self):
            u = urlparse(self.path)
            p = unquote(u.path)
            raw = self.body()
            time.sleep(LATENCY)
            if p.startswith('/peergos-api/v0/data/'):
                key = p[len('/peergos-api/v0/data/'):]
                with LOCK:
                    d = DATA.setdefault(user, {})
                    existed = key in d
                    d[key] = raw
                return self.send(200 if existed else 201, b'', headers={} if existed else {'Location': key})
            if p.startswith('/peergos-api/v0/chat/'):
                cid = p[len('/peergos-api/v0/chat/'):]
                req = self.form_or_json(raw)
                with LOCK:
                    c = CHATS.get(cid)
                    if not c or user not in c['joined']:
                        return self.send(400)
                    c['messages'].append({'type': 'Application', 'author': user, 'text': req.get('text', ''), 'timestamp': now(), 'messageRef': uuid.uuid4().hex})
                return self.send(201)
            return self.send(400)

        def do_POST(self):
            u = urlparse(self.path)
            p = unquote(u.path)
            raw = self.body()
            time.sleep(LATENCY)
            if p == '/mock/invite-order':
                INVITE_ORDER[:] = json.loads(raw or b'{}').get('order', [])
                return self.send(200)
            if p == '/mock/delay':
                req = json.loads(raw or b'{}')
                DELAY[req['user']] = {'paths': req.get('paths', []), 'seconds': float(req.get('seconds', 0))}
                return self.send(200)
            if p == '/mock/hang':
                req = json.loads(raw or b'{}')
                HANG[req['user']] = req.get('paths', [])
                return self.send(200)
            if p == '/mock/hide-list':
                req = json.loads(raw or b'{}')
                HIDE[req['user']] = {'v0': bool(req.get('v0')), 'v1': bool(req.get('v1'))}
                return self.send(200)
            if p == '/mock/join':
                req = json.loads(raw or b'{}')
                with LOCK:
                    c = CHATS[req['chat']]
                    c['joined'].add(req['user'])
                    c['messages'].append({'type': 'Join', 'joinUsername': req['user'], 'author': req['user'], 'timestamp': now()})
                return self.send(200)
            if p in ('/peergos-api/v0/chat/', '/peergos-api/v0/chat'):
                req = self.form_or_json(raw)
                n = int(req.get('maxInvites') or 1)
                others = [x for x in (INVITE_ORDER or USERS) if x != user][:n]
                cid = 'chat-ludo4peergos$%s$%s' % (user, uuid.uuid4())
                with LOCK:
                    CHATS[cid] = {'owner': user, 'title': req.get('title', ''), 'members': [user] + others, 'joined': {user},
                                  'messages': [{'type': 'Invite', 'inviteUsername': o, 'author': user, 'timestamp': now()} for o in others]}
                return self.send(201, b'', headers={'Location': cid})
            if p.startswith('/peergos-api/v0/print'):
                return self.send(200)
            return self.send(400)

        def do_DELETE(self):
            p = unquote(urlparse(self.path).path)
            if p.startswith('/peergos-api/v0/chat/'):
                cid = p[len('/peergos-api/v0/chat/'):]
                with LOCK:
                    c = CHATS.get(cid)
                    if c:
                        was = user in c['joined']
                        c['joined'].discard(user)
                        # as Peergos does (Messenger.mergeMessages): the member's message log is gone, so the chat owner's
                        # (admin's) client writes a RemoveMember entry; messages not merged before are lost (not modelled)
                        if was and user != c['owner']:
                            c['messages'].append({'type': 'RemoveMember', 'author': c['owner'], 'removeUsername': user, 'timestamp': now(), 'messageRef': uuid.uuid4().hex})
                return self.send(204)
            if p.startswith('/peergos-api/v0/data/'):
                with LOCK:
                    DATA.setdefault(user, {}).pop(p[len('/peergos-api/v0/data/'):], None)
                return self.send(204)
            return self.send(400)
    return H


def main():
    servers = []
    for spec in sys.argv[1:]:
        port, user = spec.split(':')
        USERS.append(user)
        s = ThreadingHTTPServer(('127.0.0.1', int(port)), make_handler(user))
        threading.Thread(target=s.serve_forever, daemon=True).start()
        servers.append(s)
    print('mock peergos ready', USERS, flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
