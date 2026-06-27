import http.server
import socketserver
import urllib.request
import urllib.error
import json
import os
import re

HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', '3000'))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')

class ProxyHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers for simplicity
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # Match /api/acervo/{id} or /api/acervo/{id}/exemplary-data
        api_match = re.match(r'^/api/acervo/(\d+)(?:/(exemplary-data))?$', self.path)
        if api_match:
            acervo_id = api_match.group(1)
            sub_path = api_match.group(2)
            
            target_url = f"https://pergamum.ufsc.br/api/acervo/{acervo_id}"
            if sub_path:
                target_url += f"/{sub_path}"
                
            print(f"Proxying request for acervo {acervo_id} to: {target_url}", flush=True)
            
            # Perform request to Pergamum
            req = urllib.request.Request(
                target_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            )
            
            # Disable SSL certificate verification (in case of certificate errors on internal networks)
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            try:
                with urllib.request.urlopen(req, context=ctx, timeout=10) as response:
                    data = response.read()
                    self.send_response(response.status)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.HTTPError as e:
                print(f"HTTP Error: {e.code}", flush=True)
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'HTTP Error from Pergamum', 'code': e.code}).encode('utf-8'))
            except Exception as e:
                print(f"Connection Error: {str(e)}", flush=True)
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Connection Error', 'details': str(e)}).encode('utf-8'))
            return

        # Match /api/pesquisa
        if self.path.startswith('/api/pesquisa'):
            from urllib.parse import urlparse, parse_qs, quote
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            
            termo = params.get('termo', [''])[0]
            indice = params.get('indice', [''])[0]
            coluna = params.get('coluna', ['INDICE_2'])[0]
            
            # Construct target URL
            target_url = f"https://pergamum.ufsc.br/api/v2/consulta/pesquisa_geral/pergamum_graph?termo_pesquisa={quote(termo)}&coluna_um={quote(coluna)}&indice={quote(indice)}&page=1&perPage=20&orderBy=obra&direction=C"
            
            print(f"Proxying search request for '{termo}' (ID {indice}, Coluna {coluna}) to: {target_url}", flush=True)
            
            req = urllib.request.Request(
                target_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            )
            
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            try:
                with urllib.request.urlopen(req, context=ctx, timeout=10) as response:
                    data = response.read()
                    self.send_response(response.status)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.HTTPError as e:
                print(f"HTTP Error: {e.code}", flush=True)
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'HTTP Error from Pergamum', 'code': e.code}).encode('utf-8'))
            except Exception as e:
                print(f"Connection Error: {str(e)}", flush=True)
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Connection Error', 'details': str(e)}).encode('utf-8'))
            return

        # Static file serving
        # Strip query parameters first
        path = self.path.split('?')[0]
        if path == '/':
            path = '/index.html'
        
        # Build local filepath
        # Remove leading slash to join correctly
        filepath = os.path.join(PUBLIC_DIR, path.lstrip('/'))
        
        # Security check: ensure path is within PUBLIC_DIR
        real_public_dir = os.path.realpath(PUBLIC_DIR)
        real_filepath = os.path.realpath(filepath)
        
        if not real_filepath.startswith(real_public_dir):
            self.send_response(403)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"Forbidden")
            return
            
        if os.path.exists(filepath) and os.path.isfile(filepath):
            # Determine mime type
            ext = os.path.splitext(filepath)[1].lower()
            mime_types = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon'
            }
            content_type = mime_types.get(ext, 'application/octet-stream')
            
            try:
                with open(filepath, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f"Internal Server Error: {str(e)}".encode('utf-8'))
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"Not Found")

# Running the server
if __name__ == '__main__':
    # Ensure public directory exists
    if not os.path.exists(PUBLIC_DIR):
        os.makedirs(PUBLIC_DIR)
        
    # Set handler
    handler = ProxyHTTPRequestHandler
    
    # Allow address reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer((HOST, PORT), handler) as httpd:
        print(f"Pergamum Graph Explorer running at http://{HOST}:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping server...")
