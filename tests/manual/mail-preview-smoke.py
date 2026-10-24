#!/usr/bin/env python3
"""Optional local-only React Email HTTP smoke test (Python 3, macOS/Linux).

Run after npm ci and npm run locale:compile: python3 tests/manual/mail-preview-smoke.py
Use --source /path/to/checkout to test another extracted template checkout.
No browser, email delivery, credentials, installation, or external network calls.
The temporary fixture and evidence directory are retained and printed on exit.
"""

import argparse
from html.parser import HTMLParser
from pathlib import Path
import tempfile, shutil, os, subprocess, socket, time, urllib.request, json, signal

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[2])
repo = parser.parse_args().source.resolve()
if os.name != "posix":
 parser.error("This optional helper requires macOS/Linux process-group cleanup.")
node = shutil.which("node")
if not node:
 parser.error("Node.js is required; use the supported version from package.json.")
cli = repo / "node_modules/react-email/dist/cli/index.mjs"
ui = repo / "node_modules/@react-email/ui/package.json"
if not cli.is_file() or not ui.is_file():
 parser.error("Run npm ci in the source checkout first; no packages will be installed by this test.")
if not (repo / "src/locale/paraglide/runtime.js").is_file() or not (repo / "src/locale/paraglide/messages.js").is_file():
 parser.error("Run npm run locale:compile first. This raw-CLI helper does not generate locale files; npm run email:dev generates them automatically.")

class PreviewFrame(HTMLParser):
 def __init__(self):
  super().__init__()
  self.documents = []
 def handle_starttag(self, tag, attrs):
  if tag == "iframe":
   source = dict(attrs).get("srcdoc")
   if source:
    self.documents.append(source)

def rendered_document(page):
 parser = PreviewFrame()
 parser.feed(page)
 assert parser.documents, "No rendered iframe srcDoc in preview response"
 return "\n".join(parser.documents)

root=Path(tempfile.mkdtemp(prefix='edgekit-mail-preview-'))
# Copy only public source dependencies and known fixture-safe built-in templates.
# Never copy .env, .dev.vars, provider modules, home config, or arbitrary custom templates.
shutil.copytree(repo/'src/locale', root/'src/locale')
for relative in [
 'src/mail/templates/index.ts',
 'src/mail/templates/contact-message.tsx',
 'src/mail/templates/delete-account.tsx',
 'src/mail/templates/forgot-password.tsx',
 'src/mail/templates/subscribe-newsletter.tsx',
 'src/mail/templates/verify-email.tsx',
 'src/mail/components/action-email.tsx',
 'src/mail/components/email-layout.tsx',
 'src/mail/components/email-button.tsx',
]:
 (root/relative).parent.mkdir(parents=True, exist_ok=True)
 shutil.copy2(repo/relative, root/relative)
for rel in ['src/mail/types.ts','src/newsletter/types.ts','src/notification/types.ts','src/config/website.ts','src/config/plans.ts','src/config/compatibility.ts','src/config/ai-models.ts','src/ai/policy.ts','tsconfig.json']:
 (root/rel).parent.mkdir(parents=True,exist_ok=True)
 shutil.copy2(repo/rel,root/rel)
(root/'node_modules').symlink_to(repo/'node_modules',target_is_directory=True)
(root/'package.json').write_text(json.dumps({'name':'edgekit-local-preview-fixture','private':True,'type':'module'}))
(root/'home').mkdir(); (root/'config').mkdir(); (root/'evidence').mkdir()
guard=root/'local-only.cjs'
guard.write_text('''const net = require('node:net');
const allowed = (host) => host === undefined || ['127.0.0.1', 'localhost', '::1'].includes(host);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
 const [options] = net._normalizeArgs(args);
 if (!options.path && !allowed(options.host)) throw new Error('Local preview blocks outbound network');
 return connect.apply(this, args);
};
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
 if (typeof args[0] === 'number') {
  if (typeof args[1] === 'string') args[1] = '127.0.0.1';
  else args.splice(1, 0, '127.0.0.1');
 } else if (args[0] && typeof args[0] === 'object' && !args[0].path) {
  args[0] = { ...args[0], host: '127.0.0.1' };
 }
 return listen.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
 const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
 if (!allowed(url.hostname)) throw new Error('Local preview blocks outbound fetch');
 return originalFetch(input, options);
};
''')
with socket.socket() as s:
 s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
env={'PATH':os.environ['PATH'],'HOME':str(root/'home'),'XDG_CONFIG_HOME':str(root/'config'),'NEXT_TELEMETRY_DISABLED':'1','DO_NOT_TRACK':'1','CI':'1','NO_COLOR':'1','NODE_OPTIONS':f'--require={guard}'}
log=open(root/'evidence/server.log','w')
args=[node,'--experimental-vm-modules','--disable-warning=ExperimentalWarning',str(cli),'dev','--dir','src/mail/templates','--port',str(port)]
process=subprocess.Popen(args,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
results={'root':str(root),'port':port,'guards':'isolated cwd/HOME/config; env allowlist; telemetry disabled; loopback listen and outbound network guard','requests':[]}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self, *args, **kwargs):
  raise RuntimeError("Local preview smoke does not follow HTTP redirects")

# Ignore caller proxy settings and refuse redirects away from the loopback target.
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
def get(path):
 with opener.open(f'http://127.0.0.1:{port}{path}',timeout=20) as r:
  return r.status, r.read().decode()
try:
 deadline=time.time()+45
 while True:
  if process.poll() is not None: raise Exception(f'CLI exited {process.returncode}')
  try:
   status,html=get('/')
   if status==200: break
  except (OSError,TimeoutError):
   if time.time()>deadline: raise
   time.sleep(.5)
 names=['contact-message','delete-account','forgot-password','subscribe-newsletter','verify-email']
 for name in names:
  assert f'/preview/{name}' in html, f'{name} missing from discovery'
 assert '/preview/index' not in html, 'Barrel erroneously discovered'
 assert '/preview/base-layout' not in html, 'Shared component erroneously discovered'
 results['requests'].append({'path':'/','status':status,'discovered':names,'no_barrel_or_layout':True})
 (root/'evidence/index.html').write_text(html)
 for name in names:
  status,html=get('/preview/'+name)
  (root/f'evidence/{name}.html').write_text(html)
  assert status==200 and 'Preview Reader' in rendered_document(html), f'{name} failed to render PreviewProps'
  assert 'prettyMarkup' in html, f'{name} missing actual rendering result'
  results['requests'].append({'path':'/preview/'+name,'status':status,'preview_props_rendered':True})
 # Follow the documented extension: add only a new canonical template after start.
 (root/'src/mail/templates/my-custom-email.tsx').write_text('''import { Text } from "react-email";
import EmailLayout from "../components/email-layout";
import EmailButton from "../components/email-button";
type Props = { username: string; actionUrl: string };
export default function MyCustomEmail({username, actionUrl}: Props) {
 return <EmailLayout><Text>Hello {username},</Text><EmailButton href={actionUrl}>Custom action</EmailButton></EmailLayout>;
}
MyCustomEmail.PreviewProps = { username: "Custom Discovery Fixture", actionUrl: "https://example.invalid/custom-preview" } satisfies Props;
''')
 time.sleep(.3)
 status,html=get('/')
 assert '/preview/my-custom-email' in html, 'New template not automatically discovered'
 status,html=get('/preview/my-custom-email')
 (root/'evidence/my-custom-email.html').write_text(html)
 assert status==200 and 'Custom Discovery Fixture' in rendered_document(html) and 'prettyMarkup' in html, 'Custom template rendering failed'
 assert 'https://example.invalid/custom-preview' in rendered_document(html), 'Custom PreviewProps URL missing'
 assert '<h1' in rendered_document(html), 'Public default layout heading missing'
 results['requests'].append({'path':'/preview/my-custom-email','status':status,'added_after_start':True,'public_default_layout_rendered':True,'preview_props_rendered':True,'wrapper_or_registry_change':False})
 results['status']='passed'
except Exception as e:
 results['status']='failed'; results['error']=str(e)
finally:
 if process.poll() is None:
  os.killpg(process.pid,signal.SIGTERM)
  try: process.wait(timeout=5)
  except subprocess.TimeoutExpired:
   os.killpg(process.pid,signal.SIGKILL); process.wait()
 log.close()
 results['server_stopped']=True
 (root/'evidence/result.json').write_text(json.dumps(results,indent=2))
 print(json.dumps(results,indent=2))
 print((root/'evidence/server.log').read_text()[-5500:])
 if results['status']!='passed': raise SystemExit(1)
